import { OperationsSummaryDocument, type OperationsSummaryQuery } from '@ofl/graphql-types';
import { useQuery } from 'urql';
import { Button, QueryState, Section, StatusBadge } from '../../components';

type Summary = OperationsSummaryQuery['operationsSummary'];

export function OperationsSummaryPanel() {
  const [result, refresh] = useQuery({ query: OperationsSummaryDocument, variables: { days: 14, threshold: 5 } });
  return (
    <QueryState {...result} loadingLabel="Loading operations summary…">
      {(data) => (
        <>
          <div className="toolbar">
            <Button busy={result.fetching} onClick={() => refresh({ requestPolicy: 'network-only' })}>
              Refresh
            </Button>
          </div>
          <SummaryTiles summary={data.operationsSummary} />
          <div className="dashboard-grid">
            <OrdersByStatus summary={data.operationsSummary} />
            <DailyRevenue summary={data.operationsSummary} />
            <LowStock summary={data.operationsSummary} />
          </div>
        </>
      )}
    </QueryState>
  );
}

function SummaryTiles({ summary }: { summary: Summary }) {
  const tiles = [
    { label: 'Pending jobs', value: summary.pendingJobs },
    { label: 'Failed jobs', value: summary.failedJobs },
    { label: 'Oldest pending job (s)', value: summary.oldestPendingJobAgeSeconds },
    { label: 'Expired active reservations', value: summary.expiredActiveReservations },
  ];
  return (
    <dl className="tiles">
      {tiles.map((tile) => (
        <div key={tile.label} className="tile">
          <dt>{tile.label}</dt>
          <dd>{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OrdersByStatus({ summary }: { summary: Summary }) {
  return (
    <Section title="Orders by status">
      <table className="table compact">
        <tbody>
          {summary.ordersByStatus.map((row) => (
            <tr key={row.status}>
              <th scope="row">
                <StatusBadge status={row.status} />
              </th>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function DailyRevenue({ summary }: { summary: Summary }) {
  const max = Math.max(1, ...summary.dailyRevenue.map((d) => d.revenue.amountMinor));
  return (
    <Section title="Daily revenue (UTC)">
      <table className="table compact">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Orders</th>
            <th scope="col">Revenue</th>
            <th scope="col">Cumulative</th>
          </tr>
        </thead>
        <tbody>
          {summary.dailyRevenue.map((day) => (
            <tr key={day.day}>
              <th scope="row">{day.day}</th>
              <td>{day.orders}</td>
              <td>
                <span className="bar" style={{ width: `${(day.revenue.amountMinor / max) * 100}%` }} aria-hidden="true" />
                {day.revenue.formatted}
              </td>
              <td>{day.cumulativeRevenue.formatted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function LowStock({ summary }: { summary: Summary }) {
  return (
    <Section title="Low stock">
      {summary.lowStock.length === 0 ? (
        <p>Nothing is low on stock.</p>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Warehouse</th>
              <th scope="col">Available</th>
            </tr>
          </thead>
          <tbody>
            {summary.lowStock.map((item) => (
              <tr key={`${item.sku.id}:${item.warehouse.id}`}>
                <th scope="row">
                  {item.sku.code} <span className="muted">{item.sku.label}</span>
                </th>
                <td>{item.warehouse.code}</td>
                <td>{item.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
