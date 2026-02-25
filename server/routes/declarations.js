
import express from 'express';
import { getDeclarations, getDeclarationById, getDeclarationStats, createProject } from '../controllers/declarationsController.js';

const router = express.Router();

router.get('/', getDeclarations);
router.get('/stats', getDeclarationStats);  // Must be before /:id
router.get('/:id', getDeclarationById);
router.post('/:id/create-project', createProject);

export default router;
