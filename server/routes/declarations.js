
import express from 'express';
import { getDeclarations, getDeclarationById, createProject } from '../controllers/declarationsController.js';

const router = express.Router();

router.get('/', getDeclarations);
router.get('/:id', getDeclarationById);
router.post('/:id/create-project', createProject);

export default router;
