/**
 * Smoke test for the SDK — verifies note generation, Merkle tree,
 * and Poseidon hashing work end-to-end.
 */
import { generateNote, serializeNote, deserializeNote } from '../dist/note.js';
import { MerkleTree, poseidonHash2 } from '../dist/merkle.js';

async function main() {
  console.log('=== SDK Smoke Test ===\n');

  // 1. Test note generation
  console.log('1. Generating note...');
  const note = await generateNote();
  console.log('   secret:', note.secret.toString(16).slice(0, 16) + '...');
  console.log('   nullifier:', note.nullifier.toString(16).slice(0, 16) + '...');
  console.log('   commitment:', note.commitment.toString(16).slice(0, 16) + '...');
  console.log('   nullifierHash:', note.nullifierHash.toString(16).slice(0, 16) + '...');
  console.log('   sponsorshipNullifierHash:', note.sponsorshipNullifierHash.toString(16).slice(0, 16) + '...');
  console.log('   PASS: Note generated\n');

  // 2. Test note serialization/deserialization round-trip
  console.log('2. Testing note serialize/deserialize...');
  const serialized = serializeNote(note);
  console.log('   serialized:', serialized.slice(0, 30) + '...');
  const deserialized = await deserializeNote(serialized);
  if (deserialized.commitment !== note.commitment) {
    throw new Error('Commitment mismatch after deserialization');
  }
  if (deserialized.nullifierHash !== note.nullifierHash) {
    throw new Error('NullifierHash mismatch after deserialization');
  }
  console.log('   PASS: Round-trip matches\n');

  // 3. Test Poseidon hashing
  console.log('3. Testing Poseidon hash...');
  const h1 = await poseidonHash2(1n, 2n);
  const h2 = await poseidonHash2(1n, 2n);
  const h3 = await poseidonHash2(2n, 1n);
  if (h1 !== h2) throw new Error('Poseidon hash not deterministic');
  if (h1 === h3) throw new Error('Poseidon hash collision');
  console.log('   hash(1,2):', h1.toString(16).slice(0, 16) + '...');
  console.log('   PASS: Poseidon deterministic and collision-free\n');

  // 4. Test Merkle tree
  console.log('4. Testing Merkle tree...');
  const tree = new MerkleTree(20);
  await tree.init();
  const emptyRoot = tree.getRoot();
  console.log('   empty root:', emptyRoot.toString(16).slice(0, 16) + '...');

  // Insert note commitment
  const idx = tree.insert(note.commitment);
  console.log('   inserted at index:', idx);
  const rootAfter = tree.getRoot();
  if (rootAfter === emptyRoot) throw new Error('Root unchanged after insert');
  console.log('   root after insert:', rootAfter.toString(16).slice(0, 16) + '...');

  // Get proof
  const proof = tree.getProof(0);
  if (proof.pathElements.length !== 20) throw new Error('Wrong proof depth');
  if (proof.root !== rootAfter) throw new Error('Proof root mismatch');
  console.log('   proof depth:', proof.pathElements.length);
  console.log('   PASS: Merkle tree works\n');

  // 5. Insert multiple and verify
  console.log('5. Testing multiple insertions...');
  const note2 = await generateNote();
  const note3 = await generateNote();
  tree.insert(note2.commitment);
  tree.insert(note3.commitment);
  console.log('   leaf count:', tree.leafCount);

  const proof0 = tree.getProof(0);
  const proof1 = tree.getProof(1);
  const proof2 = tree.getProof(2);
  if (proof0.root !== proof1.root || proof1.root !== proof2.root) {
    throw new Error('Proofs have different roots');
  }
  console.log('   all proofs share same root');
  console.log('   PASS: Multiple insertions work\n');

  console.log('=== All smoke tests passed! ===');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
