process.loadEnvFile();
import { hydrateAzureCache, getMonthlyReport, getDailySummary } from "./server/services/hrAiTools.js";

async function test() {
    await hydrateAzureCache();
    const monthly = await getMonthlyReport.invoke({});
    console.log("Monthly Report starts with: ", monthly.substring(0, 500));

    const daily = await getDailySummary.invoke({});
    console.log("Daily Report starts with: ", daily.substring(0, 500));
}

test().catch(console.error);
