'use client';

import AdminGuard from 'components/admin/senjamart/AdminGuard';
import Card from 'components/card';
import PageHeader from 'components/admin/ui/PageHeader';
import AIAssistant from 'components/admin/senjamart/AIAssistant';

export default function AIAssistantPage() {
  return (
    <AdminGuard>
      <div className="mt-3">
        <PageHeader
          title="AI Business Assistant"
          description={
            <>
              Asisten bisnis SenjaMart — menjawab pertanyaan dan menganalisis data
              aktual dari Supabase (omzet, pesanan, produk, stok, pelanggan). Setiap
              tindakan yang mengubah data memerlukan konfirmasi dan tercatat di audit log.
            </>
          }
        />
        <Card extra="p-6">
          <AIAssistant />
        </Card>
      </div>
    </AdminGuard>
  );
}
