import express from 'express';
import { syncDeclarations } from '../controllers/syncController.js';

const router = express.Router();

router.post('/upsert', syncDeclarations);

export default router;
