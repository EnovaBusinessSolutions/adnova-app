const mongoose = require('mongoose');
require('dotenv').config();
const McpData = require('../backend/models/McpData');
async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const doc = await McpData.findOne({ userId: '69c21ceefa3f5aff06abc9aa', dataset: 'meta.insights_summary' }).lean();
  if(!doc) { console.log('not found'); process.exit(); }
  console.log('Action keys available:');
  const sample = doc.data.summary.kpis.actions || [];
  console.log(JSON.stringify(sample, null, 2));
  process.exit();
}
run();
