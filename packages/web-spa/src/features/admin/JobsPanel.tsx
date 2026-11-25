import { JobsDocument, RetryJobDocument, type JobStatus } from '@ofl/graphql-types';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation } from 'urql';
import { Button, CursorPages, DateTime, Section, SelectField, StatusBadge } from '../../components';
import { useAppDispatch } from '../../app/store';
import { updateParams, useUrlCursors } from '../../app/useUrlCursors';
import { describeError } from '../../graphql/errors';
import { toastShown } from '../ui/uiSlice';

const STATUS_OPTIONS: ReadonlyArray<{ value: JobStatus; label: string }> = [
  { value: 'FAILED', label: 'Failed' },
  { value: 'PENDING', label: 'Pending (backlog)' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'DONE', label: 'Done' },
];

export function JobsPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('jobStatus');
  const status = STATUS_OPTIONS.find((o) => o.value === statusParam)?.value ?? 'FAILED';
  const { cursors, loadMore } = useUrlCursors('jobsAfter');
  const variablesFor = useCallback((after: string | null) => ({ status, first: 20, after }), [status]);

  return (
    <Section
      title="Jobs"
      actions={
        <SelectField
          label="Status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(e) => setSearchParams(updateParams(searchParams, { jobStatus: e.target.value }, ['jobsAfter']))}
        />
      }
    >
      <CursorPages
        query={JobsDocument}
        variablesFor={variablesFor}
        select={(data) => data.jobs}
        cursors={cursors}
        onLoadMore={loadMore}
        empty={<p>No jobs with this status.</p>}
        renderEdges={(edges) => (
          <table className="table compact">
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col">Status</th>
                <th scope="col">Attempts</th>
                <th scope="col">Last error</th>
                <th scope="col">Created</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {edges.map(({ node: job }) => (
                <tr key={job.id}>
                  <th scope="row">
                    {job.topic}
                    <div className="muted">
                      {job.aggregateType} {job.aggregateId}
                    </div>
                  </th>
                  <td>
                    <StatusBadge status={job.status} />
                  </td>
                  <td>
                    {job.attempts} / {job.maxAttempts}
                  </td>
                  <td className="wrap">{job.lastError ?? '—'}</td>
                  <td>
                    <DateTime value={job.createdAt} />
                  </td>
                  <td>{job.status === 'FAILED' ? <RetryJobButton jobId={job.id} topic={job.topic} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />
    </Section>
  );
}

function RetryJobButton({ jobId, topic }: { jobId: string; topic: string }) {
  const [{ fetching }, retryJob] = useMutation(RetryJobDocument);
  const dispatch = useAppDispatch();
  async function retry() {
    const response = await retryJob({ jobId });
    if (response.error) return void dispatch(toastShown('error', describeError(response.error).message));
    const result = response.data?.retryJob;
    if (result?.__typename === 'JobRetried') dispatch(toastShown('success', `Job ${topic} queued again.`));
    else if (result) dispatch(toastShown('error', result.message));
  }
  return (
    <Button busy={fetching} onClick={() => void retry()}>
      Retry<span className="visually-hidden"> job {topic}</span>
    </Button>
  );
}
