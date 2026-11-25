import type { Metadata } from 'next';
import type { JobStatus } from '@ofl/graphql-types';
import { loadJobs } from '@/modules/server/data/admin';
import { ADMIN_ROLES, requireRole } from '@/modules/server/session';
import { RetryJobButton } from '@/modules/admin/RetryJobButton';
import { Pagination } from '@/modules/ui/Pagination';
import { firstParam, type PageSearchParams } from '@/modules/ui/search-param';
import { formatDateTime, humanize } from '@/modules/ui/format';

export const metadata: Metadata = { title: 'Jobs' };

const STATUSES: readonly JobStatus[] = ['FAILED', 'PENDING', 'PROCESSING', 'DONE'];

type Props = { searchParams: Promise<PageSearchParams> };

export default async function JobsPage({ searchParams }: Props) {
  await requireRole(ADMIN_ROLES, '/admin/jobs');
  const params = await searchParams;
  const requested = firstParam(params, 'status');
  const status = STATUSES.find((candidate) => candidate === requested) ?? 'FAILED';
  const after = firstParam(params, 'after');
  const jobs = await loadJobs(status, after);

  return (
    <section>
      <h1>Jobs</h1>
      <form method="get" className="inline-form">
        <label htmlFor="job-status">Status</label>
        <select id="job-status" name="status" defaultValue={status}>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </select>
        <button type="submit">Show</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col">Aggregate</th>
              <th scope="col">Attempts</th>
              <th scope="col">Last error</th>
              <th scope="col">Available at</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.edges.map(({ node }) => (
              <tr key={node.id}>
                <th scope="row">{node.topic}</th>
                <td>
                  {node.aggregateType} {node.aggregateId}
                </td>
                <td>
                  {node.attempts}/{node.maxAttempts}
                </td>
                <td>{node.lastError ?? '—'}</td>
                <td>{formatDateTime(node.availableAt)}</td>
                <td>{node.status === 'FAILED' && <RetryJobButton jobId={node.id} topic={node.topic} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {jobs.edges.length === 0 && <p>No {humanize(status).toLowerCase()} jobs.</p>}
      <Pagination
        basePath="/admin/jobs"
        params={new URLSearchParams({ status })}
        hasNextPage={jobs.pageInfo.hasNextPage}
        endCursor={jobs.pageInfo.endCursor}
        isFirstPage={after === null}
      />
    </section>
  );
}
