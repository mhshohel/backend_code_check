import { Button } from './Button';

type LoadMoreProps = {
  hasNextPage: boolean;
  endCursor: string | null;
  fetching?: boolean;
  onLoadMore: (cursor: string) => void;
  label?: string;
};

export function LoadMore({ hasNextPage, endCursor, fetching = false, onLoadMore, label = 'Load more' }: LoadMoreProps) {
  if (!hasNextPage || !endCursor) return null;
  return (
    <div className="load-more">
      <Button busy={fetching} onClick={() => onLoadMore(endCursor)}>
        {fetching ? 'Loading…' : label}
      </Button>
    </div>
  );
}
