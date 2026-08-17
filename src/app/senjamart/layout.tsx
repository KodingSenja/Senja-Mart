'use client';

import { CartProvider } from 'contexts/CartContext';
import { AuthProvider } from 'contexts/AuthContext';
import TopNavbar from 'components/senjamart/layout/TopNavbar';
import Navbar from 'components/senjamart/layout/Navbar';
import Footer from 'components/senjamart/layout/Footer';

export default function SenjaMartLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <CartProvider>
        <div className="flex min-h-screen flex-col bg-white font-inter text-fresh-gray-800 antialiased">
          <TopNavbar />
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </CartProvider>
    </AuthProvider>
  );
}
