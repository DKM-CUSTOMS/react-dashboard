// API endpoints for Fiscal Representation principals management
// Uses the Express server proxy at /api/fiscal

const FISCAL_API_BASE = "/api/fiscal";

/**
 * Get all principals
 * @returns {Promise<string[]>} Array of principal names
 */
export async function getPrincipals() {
  try {
    const response = await fetch(`${FISCAL_API_BASE}/principals`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch principals: ${response.status}`);
    }

    const data = await response.json();
    return data.principals || [];
  } catch (error) {
    console.error('Error fetching principals:', error);
    throw error;
  }
}

/**
 * Add a new principal
 * @param {string} name - Principal name
 * @returns {Promise<Object>} Response data
 */
export async function addPrincipal(name) {
  try {
    const response = await fetch(`${FISCAL_API_BASE}/principals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to add principal: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error adding principal:', error);
    throw error;
  }
}

/**
 * Update a principal name
 * @param {string} oldName - Current name
 * @param {string} newName - New name
 * @returns {Promise<Object>} Response data
 */
export async function updatePrincipal(oldName, newName) {
  try {
    const response = await fetch(`${FISCAL_API_BASE}/principals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName, newName }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to update principal: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating principal:', error);
    throw error;
  }
}

/**
 * Delete a principal
 * @param {string} name - Principal name to delete
 * @returns {Promise<Object>} Response data
 */
export async function deletePrincipal(name) {
  try {
    const response = await fetch(`${FISCAL_API_BASE}/principals`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to delete principal: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error deleting principal:', error);
    throw error;
  }
}
