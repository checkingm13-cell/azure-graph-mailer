const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Test the CSV streaming parser directly
const csvParser = require('csv-parser');

async function testFastCsvParser() {
  console.log('--- Testing High-Speed Streaming CSV Parser ---');

  const testCsvPath = path.join(__dirname, 'test_speed.csv');
  const rowCount = 5000;
  let content = 'Name,Email,Paper Title,Affiliation\n';
  for (let i = 1; i <= rowCount; i++) {
    content += `Author ${i},author_${i}@example.com,Quantum Physics Vol ${i},Tech Institute\n`;
  }
  fs.writeFileSync(testCsvPath, content);

  const t0 = performance.now();
  const rows = await new Promise((resolve, reject) => {
    const list = [];
    fs.createReadStream(testCsvPath)
      .pipe(csvParser({
        mapHeaders: ({ header }) => header.trim().replace(/^["']|["']$/g, '')
      }))
      .on('data', (data) => {
        if (data && Object.keys(data).length > 0) list.push(data);
      })
      .on('end', () => resolve(list))
      .on('error', reject);
  });
  const t1 = performance.now();

  const durationMs = (t1 - t0).toFixed(2);
  console.log(`✅ Parsed ${rows.length} CSV rows in ${durationMs}ms!`);

  assert.strictEqual(rows.length, 5000);
  assert.strictEqual(rows[0].Name, 'Author 1');
  assert.strictEqual(rows[0].Email, 'author_1@example.com');
  assert.ok(durationMs < 1000, 'Streaming parser must be sub-second');

  fs.unlinkSync(testCsvPath);
  console.log('✅ CSV Streaming Parser Benchmark PASSED CLEANLY!');
}

testFastCsvParser().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
