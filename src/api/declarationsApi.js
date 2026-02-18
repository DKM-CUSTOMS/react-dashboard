
// src/api/declarationsApi.js

const BASE_URL = '/api/declarations';

export const getDeclarations = async ({ page = 1, pageSize = 50, filters = {} }) => {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
    ...filters,
  });

  const response = await fetch(`${BASE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to fetch declarations');
  }
  return response.json();
};

export const getDeclarationById = async (id) => {
  const response = await fetch(`${BASE_URL}/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch declaration');
  }
  return response.json();
};

export const createOdooProject = async (id) => {
  const response = await fetch(`${BASE_URL}/${id}/create-project`, {
    method: 'POST',
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to create Odoo project');
  }
  return response.json();
};
