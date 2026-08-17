import React from 'react';

// Icon Imports
import {
  MdHome,
  MdCategory,
  MdReceiptLong,
  MdInventory,
  MdInventory2,
  MdCampaign,
  MdBarChart,
  MdAutoAwesome,
} from 'react-icons/md';

const routes = [
  {
    name: 'Dashboard',
    layout: '/admin',
    path: 'senjamart',
    icon: <MdHome className="h-6 w-6" />,
  },
  {
    name: 'Produk',
    layout: '/admin',
    path: 'senjamart/products',
    icon: <MdInventory2 className="h-6 w-6" />,
  },
  {
    name: 'Stok',
    layout: '/admin',
    path: 'senjamart/inventory',
    icon: <MdInventory className="h-6 w-6" />,
  },
  {
    name: 'Kategori',
    layout: '/admin',
    path: 'senjamart/categories',
    icon: <MdCategory className="h-6 w-6" />,
  },
  {
    name: 'Pesanan',
    layout: '/admin',
    path: 'senjamart/orders',
    icon: <MdReceiptLong className="h-6 w-6" />,
  },
  {
    name: 'Laporan',
    layout: '/admin',
    path: 'senjamart/reports',
    icon: <MdBarChart className="h-6 w-6" />,
  },
  {
    name: 'Marketing',
    layout: '/admin',
    path: 'senjamart/marketing',
    icon: <MdCampaign className="h-6 w-6" />,
  },
  {
    name: 'AI Agent',
    layout: '/admin',
    path: 'senjamart/ai',
    icon: <MdAutoAwesome className="h-6 w-6" />,
  },
];
export default routes;
