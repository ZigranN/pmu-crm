import { requireBrowserStudioContext } from "@/server/auth/context";
import {
  getAutomationRules,
  getAutomationJobs,
  getAutomationExecutions,
  getAutomationStats,
} from "@/features/automations/server/queries";
import { AutomationsDashboard } from "@/features/automations/components/automations-dashboard";

export default async function AutomationsPage() {
  const context = await requireBrowserStudioContext();

  const [rules, jobs, executions, stats] = await Promise.all([
    getAutomationRules(),
    getAutomationJobs(),
    getAutomationExecutions(),
    getAutomationStats(),
  ]);

  return (
    <AutomationsDashboard
      rules={rules}
      jobs={jobs}
      executions={executions}
      stats={stats}
      userRole={context.role}
    />
  );
}
