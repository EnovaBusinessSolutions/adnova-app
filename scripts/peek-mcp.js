const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });
const McpData = require('../backend/models/McpData');
async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const docs = await McpData.find({ userId: '69c21ceefa3f5aff06abc9aa', source: 'metaAds' }).lean().limit(10);
  console.log(JSON.stringify(docs.map(d => ({id: d._id, dataset: d.dataset, hasData: !!d.data, dataKeys: Object.keys(d.data || {})})), null, 2));
  const doc = docs.find(d => d.dataset === 'meta.insights_summary');
  if(doc) {
    console.log('summaryData keys:', Object.keys(doc.data));
    console.log('summary:', JSON.stringify(doc.data.summary, null, 2));
  }
  process.exit();
}
run();
