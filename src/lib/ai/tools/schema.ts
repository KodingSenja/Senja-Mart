/**
 * Tool parameter schemas (JSON Schema, OpenAI function-calling format).
 * The model may only call tools with these validated shapes; every handler
 * re-validates its own inputs before touching the database.
 */

const s = (type: string, description: string, extra: Record<string, unknown> = {}) => ({
  type,
  description,
  ...extra,
});

export const toolSchemas: Record<string, Record<string, unknown>> = {
  // ---------------------------------------------------------------- READ
  get_dashboard_summary: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  get_revenue: {
    type: 'object',
    properties: {
      period: s('string', 'Periode: today | 7d | 30d | thisMonth | all', {
        enum: ['today', '7d', '30d', 'thisMonth', 'all'],
      }),
      compare: s('boolean', 'Sertakan perbandingan dengan periode sebelumnya (default true)'),
    },
    required: ['period'],
    additionalProperties: false,
  },
  get_orders: {
    type: 'object',
    properties: {
      status: s('string', 'Filter status order: pending | processing | shipped | delivered | cancelled'),
      payment_status: s('string', 'Filter pembayaran: unpaid | pending | paid | expired | failed | refunded'),
      search: s('string', 'Cari nomor order atau nama customer'),
      limit: s('integer', 'Jumlah maksimal (1-50)', { minimum: 1, maximum: 50 }),
    },
    additionalProperties: false,
  },
  get_order_detail: {
    type: 'object',
    properties: {
      order_id: s('string', 'UUID order'),
    },
    required: ['order_id'],
    additionalProperties: false,
  },
  get_products: {
    type: 'object',
    properties: {
      search: s('string', 'Cari nama produk'),
      category_id: s('string', 'UUID kategori'),
      include_inactive: s('boolean', 'Sertakan produk nonaktif'),
      limit: s('integer', 'Jumlah maksimal (1-100)', { minimum: 1, maximum: 100 }),
    },
    additionalProperties: false,
  },
  get_categories: {
    type: 'object',
    properties: {
      limit: s('integer', 'Jumlah maksimal (1-100)', { minimum: 1, maximum: 100 }),
    },
    additionalProperties: false,
  },
  get_inventory: {
    type: 'object',
    properties: {
      status: s('string', 'Filter status stok: safe | low | out', { enum: ['safe', 'low', 'out'] }),
      limit: s('integer', 'Jumlah maksimal (1-100)', { minimum: 1, maximum: 100 }),
    },
    additionalProperties: false,
  },
  get_sales_analytics: {
    type: 'object',
    properties: {
      period: s('string', 'Periode: 7d | 30d | thisMonth', { enum: ['7d', '30d', 'thisMonth'] }),
    },
    required: ['period'],
    additionalProperties: false,
  },
  get_top_products: {
    type: 'object',
    properties: {
      period: s('string', 'Periode: today | 7d | 30d | thisMonth | all', {
        enum: ['today', '7d', '30d', 'thisMonth', 'all'],
      }),
      limit: s('integer', 'Jumlah maksimal (1-20)', { minimum: 1, maximum: 20 }),
    },
    additionalProperties: false,
  },
  get_low_stock_products: {
    type: 'object',
    properties: {
      limit: s('integer', 'Jumlah maksimal (1-50)', { minimum: 1, maximum: 50 }),
    },
    additionalProperties: false,
  },
  get_customer_summary: {
    type: 'object',
    properties: {
      limit: s('integer', 'Jumlah customer teratas (1-20)', { minimum: 1, maximum: 20 }),
    },
    additionalProperties: false,
  },
  get_payment_status: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  get_refund_status: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  // ------------------------------------------------------------ ANALYSIS
  analyze_sales: {
    type: 'object',
    properties: {
      period: s('string', 'Periode: 7d | 30d | thisMonth', { enum: ['7d', '30d', 'thisMonth'] }),
    },
    required: ['period'],
    additionalProperties: false,
  },
  analyze_revenue: {
    type: 'object',
    properties: {
      period: s('string', 'Periode: today | 7d | 30d | thisMonth', {
        enum: ['today', '7d', '30d', 'thisMonth'],
      }),
    },
    required: ['period'],
    additionalProperties: false,
  },
  analyze_inventory: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  analyze_orders: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  detect_sales_anomaly: {
    type: 'object',
    properties: {
      period: s('string', 'Periode pembanding: 7d | 30d', { enum: ['7d', '30d'] }),
    },
    required: ['period'],
    additionalProperties: false,
  },
  detect_low_stock: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  generate_business_summary: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  generate_business_recommendations: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  // -------------------------------------------------------------- ACTION
  update_order_status: {
    type: 'object',
    properties: {
      order_id: s('string', 'UUID pesanan ATAU nomor order (mis. SJ-20260813-FE1526)'),
      status: s('string', 'Status baru (kecuali cancelled): processing | shipped | delivered', {
        enum: ['processing', 'shipped', 'delivered'],
      }),
    },
    required: ['order_id', 'status'],
    additionalProperties: false,
  },
  update_product: {
    type: 'object',
    properties: {
      product_id: s('string', 'UUID produk ATAU nama produk'),
      is_active: s('boolean', 'Aktif/tidak di toko'),
      is_popular: s('boolean', 'Masuk Produk Populer'),
      featured: s('boolean', 'Produk unggulan'),
      badge: s('string', 'Badge: sale | hot | new (null untuk hapus)', { enum: ['sale', 'hot', 'new', null] }),
    },
    required: ['product_id'],
    additionalProperties: false,
  },
  update_marketing_content: {
    type: 'object',
    properties: {
      id: s('string', 'UUID konten marketing'),
      is_active: s('boolean', 'Aktif/tidak di homepage'),
      sort_order: s('integer', 'Urutan tampil'),
      badge: s('string', 'Badge (mis. label promo)'),
      title: s('string', 'Judul'),
      subtitle: s('string', 'Subjudul'),
      description: s('string', 'Deskripsi'),
      cta_text: s('string', 'Teks tombol'),
      cta_url: s('string', 'URL tombol'),
    },
    required: ['id'],
    additionalProperties: false,
  },
};
