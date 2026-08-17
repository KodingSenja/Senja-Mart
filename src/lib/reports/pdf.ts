import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  DailyRevenue,
  ReportSummary,
  ReportTransaction,
  TopItem,
} from 'lib/services/reports';
import type { OrderStatus, PaymentStatus } from 'types/order';

/**
 * Export the sales report to a professional A4 PDF (client-side).
 * Data passed in is EXACTLY the same aggregated data shown on the page —
 * the PDF never queries or computes anything on its own.
 */

const NAVY = '#2B3674';
const BRAND = '#4318FF';
const GRAY = '#A3AED0';
const LIGHT = '#F4F7FE';

function fmtRp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

const statusLabel: Record<OrderStatus, string> = {
  pending: 'Menunggu',
  processing: 'Diproses',
  shipped: 'Dikirim',
  delivered: 'Selesai',
  cancelled: 'Dibatalkan',
};

const paymentLabel: Record<PaymentStatus, string> = {
  unpaid: 'Belum Bayar',
  pending: 'Menunggu',
  paid: 'Lunas',
  expired: 'Kedaluwarsa',
  failed: 'Gagal',
  refunded: 'Dikembalikan',
};

interface ReportPdfInput {
  periodLabel: string;
  summary: ReportSummary;
  daily: DailyRevenue[];
  topProducts: TopItem[];
  topCategories: TopItem[];
  transactions: ReportTransaction[];
  comparisonText?: string;
}

/** Simple bar chart drawn with vector rects — no canvas/image needed. */
function drawRevenueChart(
  doc: jsPDF,
  data: DailyRevenue[],
  startY: number
): number {
  const x0 = 14;
  const w = 182;
  const h = 52;
  const chartTitle = 'Grafik Omzet per Hari (Asia/Jakarta)';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(NAVY);
  doc.text(chartTitle, x0, startY);

  const top = startY + 8;
  const hasRevenue = data.some((p) => p.revenue > 0);

  if (!hasRevenue) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(GRAY);
    doc.text('Belum ada omzet pada periode ini.', x0 + 2, top + h / 2);
    return top + h + 6;
  }

  const max = Math.max(1, ...data.map((p) => p.revenue));
  const n = data.length;
  const gap = n > 40 ? 0.4 : 1.5;
  const barW = (w - gap * (n - 1)) / n;

  // Baseline + max gridline
  doc.setDrawColor(LIGHT);
  doc.setLineWidth(0.3);
  doc.line(x0, top + h, x0 + w, top + h);
  doc.setFontSize(6.5);
  doc.setTextColor(GRAY);
  doc.text(fmtRp(max), x0 + w + 1, top + 2);

  data.forEach((p, i) => {
    const barH = (p.revenue / max) * (h - 2);
    const bx = x0 + i * (barW + gap);
    const by = top + h - barH;
    if (p.revenue > 0) {
      doc.setFillColor(BRAND);
      doc.rect(bx, by, barW, barH, 'F');
    } else {
      doc.setFillColor(LIGHT);
      doc.rect(bx, top + h - 2, barW, 2, 'F');
    }
    if (n <= 14) {
      doc.setFontSize(5.5);
      doc.setTextColor(GRAY);
      const [, m, d] = p.date.split('-');
      doc.text(`${d}/${m}`, bx + barW / 2, top + h + 3.5, { align: 'center' });
    }
  });

  // Total omzet footer under the chart
  const total = data.reduce((s, p) => s + p.revenue, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(NAVY);
  doc.text(`Total omzet periode: ${fmtRp(total)}`, x0, top + h + 10);

  return top + h + 16;
}

function sectionTitle(doc: jsPDF, y: number, text: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(NAVY);
  doc.text(text, 14, y);
  return y + 2;
}

export function exportReportPdf(input: ReportPdfInput): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ---- Header band ----
  doc.setFillColor(NAVY);
  doc.rect(0, 0, pageW, 30, 'F');
  doc.setFillColor(BRAND);
  doc.rect(0, 30, pageW, 1.6, 'F');

  doc.setTextColor('#FFFFFF');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Senja Mart', 14, 13);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Laporan Penjualan', 14, 20);

  doc.setFontSize(9);
  doc.text(`Periode: ${input.periodLabel}`, pageW - 14, 13, {
    align: 'right',
  });
  doc.text(`Dibuat: ${fmtDate(new Date().toISOString())}`, pageW - 14, 19, {
    align: 'right',
  });

  let y = 42;

  // ---- Ringkasan ----
  y = sectionTitle(doc, y, 'Ringkasan');
  autoTable(doc, {
    startY: y + 2,
    margin: { left: 14, right: 14 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 2.5,
      textColor: NAVY,
      lineColor: [227, 230, 244],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: LIGHT,
      textColor: GRAY,
      fontStyle: 'bold',
      fontSize: 8,
    },
    head: [['Metrik', 'Nilai', 'Metrik', 'Nilai']],
    body: [
      ['Total Omzet', fmtRp(input.summary.totalOmzet), 'Total Pesanan', String(input.summary.totalOrders)],
      ['Pesanan Lunas', String(input.summary.paidOrders), 'Belum Dibayar', String(input.summary.unpaidOrders)],
      ['Selesai', String(input.summary.deliveredOrders), 'Dibatalkan', String(input.summary.cancelledOrders)],
      [
        'Rata-rata Nilai Pesanan',
        fmtRp(input.summary.avgOrderValue),
        'Perbandingan (periode lalu)',
        input.comparisonText ?? '—',
      ],
    ],
    columnStyles: {
      1: { halign: 'right' },
      3: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ---- Grafik ----
  y = drawRevenueChart(doc, input.daily, y);

  // ---- Produk & Kategori terlaris ----
  y = sectionTitle(doc, y, 'Produk Terlaris (Top 10)');
  autoTable(doc, {
    startY: y + 2,
    margin: { left: 14, right: 14 },
    theme: 'striped',
    headStyles: { fillColor: NAVY, textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 8.5 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, textColor: NAVY },
    head: [['#', 'Produk', 'Unit Terjual', 'Omzet']],
    body:
      input.topProducts.length === 0
        ? [['—', 'Tidak ada penjualan pada periode ini.', '', '']]
        : input.topProducts.map((p, i) => [
            String(i + 1),
            p.name,
            String(p.quantitySold),
            fmtRp(p.revenue),
          ]),
    columnStyles: {
      0: { cellWidth: 10 },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  y = sectionTitle(doc, y, 'Kategori Terlaris (Top 5)');
  autoTable(doc, {
    startY: y + 2,
    margin: { left: 14, right: 14 },
    theme: 'striped',
    headStyles: { fillColor: NAVY, textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 8.5 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, textColor: NAVY },
    head: [['#', 'Kategori', 'Unit', 'Omzet']],
    body:
      input.topCategories.length === 0
        ? [['—', 'Tidak ada penjualan pada periode ini.', '', '']]
        : input.topCategories.map((c, i) => [
            String(i + 1),
            c.name,
            String(c.quantitySold),
            fmtRp(c.revenue),
          ]),
    columnStyles: {
      0: { cellWidth: 10 },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ---- Detail transaksi ----
  y = sectionTitle(doc, y, 'Detail Transaksi');
  const grandTotal = input.transactions.reduce((s, t) => s + t.total, 0);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: 14, right: 14 },
    theme: 'striped',
    headStyles: { fillColor: NAVY, textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 8.5 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, textColor: NAVY },
    head: [['Tanggal', 'Order', 'Customer', 'Total', 'Pembayaran', 'Status']],
    body:
      input.transactions.length === 0
        ? [['—', 'Tidak ada transaksi pada periode ini.', '', '', '', '']]
        : input.transactions.map((t) => [
            fmtDate(t.date),
            t.orderNumber,
            t.customer ?? '—',
            fmtRp(t.total),
            paymentLabel[t.paymentStatus] ?? t.paymentStatus,
            statusLabel[t.status] ?? t.status,
          ]),
    foot: [['', '', 'Total', fmtRp(grandTotal), `${input.transactions.length} transaksi`, '']],
    footStyles: {
      fillColor: LIGHT,
      textColor: NAVY,
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 38 },
      3: { halign: 'right' },
    },
  });

  // ---- Footer + page numbers ----
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(LIGHT);
    doc.setLineWidth(0.2);
    doc.line(14, pageH - 12, pageW - 14, pageH - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(GRAY);
    doc.text('Senja Mart · Laporan Penjualan', 14, pageH - 7);
    doc.text(
      `Halaman ${i} dari ${totalPages}`,
      pageW - 14,
      pageH - 7,
      { align: 'right' }
    );
  }

  const slug = input.periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  doc.save(`laporan-penjualan-${slug || 'periode'}.pdf`);
}
