import { PageHeader } from '../../components';
import { AuditLogPanel } from './AuditLogPanel';
import { JobsPanel } from './JobsPanel';
import { OperationsSummaryPanel } from './OperationsSummaryPanel';
import { PriceUpdateForm } from './PriceUpdateForm';

export function AdminPage() {
  return (
    <div>
      <PageHeader title="Operations" />
      <OperationsSummaryPanel />
      <div className="dashboard-grid">
        <JobsPanel />
        <PriceUpdateForm />
        <AuditLogPanel />
      </div>
    </div>
  );
}
