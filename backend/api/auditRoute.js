const express = require('express');
const router = express.Router();
const { enqueueAudit, getJob } = require('../queue');

// Inicia auditoría
router.post('/start', async (req, res) => {
  const { shop, accessToken } = req.body;
  if (!shop || !accessToken) 
    return res.status(400).json({ error: 'Falta shop o accessToken' });

  try {
    const job = await enqueueAudit(shop, accessToken);
    res.json({ jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar auditoría', details: err.message });
  }
});

// Consulta progreso
router.get('/progress/:id', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });

  res.json({ 
    progress: job.progress, 
    finished: !!job.finishedOn,
    result: job.returnvalue || null 
  });
});

module.exports = router;
