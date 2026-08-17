import React, { ReactNode } from 'react';
import AppWrappers from './AppWrappers';

export const metadata = {
  title: 'Senja Mart',
  description: 'Senja Mart — Belanja kebutuhan sehari-hari dengan mudah.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body id={'root'}>
        <AppWrappers>{children}</AppWrappers>
      </body>
    </html>
  );
}
