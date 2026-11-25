'use client';

import Link from 'next/link';
import { cartItemCount } from './cart-slice';
import { useAppSelector } from '../store/hooks';

export function CartLink() {
  const count = useAppSelector((state) => cartItemCount(state.cart));
  return (
    <Link href="/cart">
      Cart<span aria-label={`${count} items`}> ({count})</span>
    </Link>
  );
}
