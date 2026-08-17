import Image from 'next/image';
import Link from 'next/link';

const categoryLinksLeft = [
  'Buah & Sayur',
  'Sarapan & Makanan Instan',
  'Bakery & Biskuit',
  'Beras, Tepung & Kacang',
  'Saus & Olesan',
  'Organik & Gourmet',
  'Perawatan Bayi',
  'Kebersihan Rumah',
  'Perawatan Pribadi',
];

const categoryLinksRight = [
  'Susu, Roti & Telur',
  'Minuman Dingin & Jus',
  'Teh, Kopi & Minuman',
  'Bumbu & Minyak',
  'Ayam, Daging & Ikan',
  'Pojok Makanan Ringan',
  'Farmasi & Kesehatan',
  'Rumah & Kantor',
  'Perawatan Hewan',
];

const aboutLinks = [
  'Perusahaan',
  'Tentang Kami',
  'Blog',
  'Pusat Bantuan',
  'Nilai Kami',
];

const consumerLinks = [
  'Pembayaran',
  'Pengiriman',
  'Retur Produk',
  'FAQ',
  'Checkout',
];

const shopperLinks = [
  'Peluang Belanja',
  'Jadi Mitra Belanja',
  'Pendapatan',
  'Ide & Panduan',
  'Retailer Baru',
];

const programLinks = [
  'Program Senja Mart',
  'Kartu Hadiah',
  'Promo & Kupon',
  'Iklan Senja Mart',
  'Karier',
];

function LinkColumn({ title, links }: { title: string; links: string[] }) {
  return (
    <div className="mb-6 flex w-1/2 flex-col gap-4 sm:w-1/2 md:w-1/4">
      <h6 className="text-sm font-semibold text-fresh-gray-900">{title}</h6>
      <ul className="flex flex-col gap-2">
        {links.map((label) => (
          <li key={label}>
            <Link
              href="/senjamart/products"
              className="inline-block text-sm text-fresh-gray-600 transition-colors hover:text-fresh-green-600"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="bg-fresh-gray-200 py-8 font-inter">
      <div className="container mx-auto max-w-[1320px] px-4">
        <div className="mb-6 flex flex-wrap gap-y-6 py-4 md:gap-4 lg:gap-0">
          {/* Categories */}
          <div className="mb-6 flex w-full flex-col gap-4 lg:w-1/3">
            <h6 className="text-sm font-semibold text-fresh-gray-900">
              Kategori
            </h6>
            <div className="flex flex-wrap">
              <ul className="flex w-1/2 flex-col gap-2">
                {categoryLinksLeft.map((label) => (
                  <li key={label}>
                    <Link
                      href="/senjamart/categories/semua"
                      className="inline-block text-sm text-fresh-gray-600 transition-colors hover:text-fresh-green-600"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
              <ul className="flex w-1/2 flex-col gap-2">
                {categoryLinksRight.map((label) => (
                  <li key={label}>
                    <Link
                      href="/senjamart/categories/semua"
                      className="inline-block text-sm text-fresh-gray-600 transition-colors hover:text-fresh-green-600"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Link columns */}
          <div className="flex w-full flex-wrap lg:w-2/3">
            <LinkColumn title="Kenali Kami" links={aboutLinks} />
            <LinkColumn title="Untuk Konsumen" links={consumerLinks} />
            <LinkColumn title="Jadi Mitra Belanja" links={shopperLinks} />
            <LinkColumn title="Program Senja Mart" links={programLinks} />
          </div>
        </div>

        {/* Payment + shipping */}
        <div className="flex flex-wrap items-center justify-center gap-y-4 border-t border-fresh-gray-300 py-4 lg:justify-start">
          <div className="text-center lg:w-3/5 lg:text-left">
            <div className="flex flex-col items-center gap-3 md:flex-row md:gap-6">
              <div className="text-sm font-semibold text-fresh-gray-900">
                Mitra Pembayaran
              </div>
              <ul className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <li>
                  <Image
                    src="/senjamart/payment/qris.svg"
                    alt="QRIS"
                    width={64}
                    height={24}
                    className="h-6 w-auto"
                  />
                </li>
                <li>
                  <Image
                    src="/senjamart/payment/gopay.svg"
                    alt="GoPay"
                    width={96}
                    height={24}
                    className="h-6 w-auto"
                  />
                </li>
                <li>
                  <Image
                    src="/senjamart/payment/ovo.svg"
                    alt="OVO"
                    width={80}
                    height={24}
                    className="h-6 w-auto"
                  />
                </li>
                <li>
                  <Image
                    src="/senjamart/payment/virtual-account.svg"
                    alt="Virtual Account"
                    width={170}
                    height={24}
                    className="h-6 w-auto"
                  />
                </li>
              </ul>
            </div>
          </div>
          <div className="flex justify-center lg:w-2/5 lg:justify-end">
            <div className="flex flex-col items-center gap-3 md:flex-row md:gap-6">
              <div className="text-sm font-semibold text-fresh-gray-900">
                Pengiriman
              </div>
              <ul className="flex items-center">
                <li>
                  <Image
                    src="/senjamart/appbutton/karib.svg"
                    alt="Karib Express"
                    width={300}
                    height={56}
                    className="h-8 w-auto"
                  />
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-center gap-3 border-t border-fresh-gray-300 py-4 md:flex-row">
          <div className="w-full">
            <span className="text-sm text-fresh-gray-500">
              © {new Date().getFullYear()} Senja Mart — Supermarket Online untuk
              Kebutuhan Segar &amp; Harian.
            </span>
          </div>
          <div className="flex items-center md:w-1/2 md:justify-end">
            <div className="flex items-center gap-5">
              <div className="text-sm text-fresh-gray-500">Ikuti kami di</div>
              <ul className="flex items-center gap-1 text-sm">
                <li>
                  <a
                    href="#!"
                    aria-label="Facebook"
                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-fresh-gray-300 text-fresh-gray-600 transition hover:border-fresh-green-600 hover:text-fresh-green-600"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M7 10v4h3v7h4v-7h3l1 -4h-4v-2a1 1 0 0 1 1 -1h3v-4h-3a5 5 0 0 0 -5 5v2h-3" />
                    </svg>
                  </a>
                </li>
                <li>
                  <a
                    href="#!"
                    aria-label="Twitter / X"
                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-fresh-gray-300 text-fresh-gray-600 transition hover:border-fresh-green-600 hover:text-fresh-green-600"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
                      <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
                    </svg>
                  </a>
                </li>
                <li>
                  <a
                    href="#!"
                    aria-label="Instagram"
                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-fresh-gray-300 text-fresh-gray-600 transition hover:border-fresh-green-600 hover:text-fresh-green-600"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 4m0 4a4 4 0 0 1 4 -4h8a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-8a4 4 0 0 1 -4 -4z" />
                      <path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
                      <path d="M16.5 7.5l0 .01" />
                    </svg>
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
