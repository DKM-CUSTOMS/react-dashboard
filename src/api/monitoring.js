const BASE_URL = '/api/monitoring';

export const fetchAllMonitoringData = async (days = 7) => {
    const res = await fetch(`${BASE_URL}/all?days=${days}`);
    if (!res.ok) throw new Error('Failed to fetch monitoring data');
    return res.json();
};

export const fetchRunDetails = async (logic_app_name, run_id, date) => {
    const res = await fetch(`${BASE_URL}/runs/${run_id}?logic_app_name=${logic_app_name}&date=${date}`);
    if (!res.ok) throw new Error('Failed to fetch run details');
    return res.json();
};
