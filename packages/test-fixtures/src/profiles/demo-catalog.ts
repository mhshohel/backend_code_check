// Catalog content for the demo profile: 8 categories, 60 products.
// Prices are base prices in cents; variants add a small premium.

export type DemoProductSpec = { name: string; description: string; basePriceMinor: number; variants: readonly string[] };
export type DemoCategorySpec = { slug: string; name: string; code: string; products: readonly DemoProductSpec[] };

const p = (name: string, basePriceMinor: number, variants: readonly string[], description: string): DemoProductSpec => ({
  name,
  basePriceMinor,
  variants,
  description,
});

export const DEMO_CATALOG: readonly DemoCategorySpec[] = [
  {
    slug: 'audio',
    name: 'Audio',
    code: 'AUD',
    products: [
      p('Wireless Headphones', 12900, ['Black', 'Silver'], 'Over-ear headphones with active noise cancelling and 30-hour battery.'),
      p('Studio Monitor Headphones', 9900, ['Standard'], 'Closed-back headphones with a flat response for mixing.'),
      p('Bluetooth Speaker', 5900, ['Blue', 'Red', 'Black'], 'Water-resistant portable speaker with deep bass.'),
      p('Soundbar', 24900, ['Standard'], 'Slim soundbar with a wireless subwoofer.'),
      p('Earbuds Pro', 14900, ['White', 'Black'], 'True wireless earbuds with transparency mode.'),
      p('Turntable', 19900, ['Walnut', 'Black'], 'Belt-drive turntable with a built-in preamp.'),
      p('USB Microphone', 7900, ['Standard'], 'Cardioid condenser microphone for podcasts and calls.'),
      p('Headphone Amplifier', 8900, ['Standard'], 'Compact amplifier for high-impedance headphones.'),
    ],
  },
  {
    slug: 'computers',
    name: 'Computers',
    code: 'CMP',
    products: [
      p('Mechanical Keyboard', 8900, ['Red Switches', 'Brown Switches', 'Blue Switches'], 'Tenkeyless keyboard with hot-swappable switches.'),
      p('Wireless Mouse', 3900, ['Graphite', 'White'], 'Ergonomic mouse with silent clicks.'),
      p('27-inch Monitor', 32900, ['Standard'], '1440p IPS monitor with 144 Hz refresh rate.'),
      p('USB-C Hub', 4900, ['Standard'], 'Seven-port hub with HDMI, SD card reader, and 100 W pass-through.'),
      p('Laptop Stand', 3400, ['Silver', 'Space Gray'], 'Aluminium stand that raises the screen to eye level.'),
      p('External SSD', 11900, ['1 TB', '2 TB'], 'Portable solid-state drive with USB 3.2 speed.'),
      p('Webcam 4K', 9900, ['Standard'], 'Ultra HD webcam with auto focus and dual microphones.'),
      p('Docking Station', 18900, ['Standard'], 'Thunderbolt dock for two external displays.'),
    ],
  },
  {
    slug: 'home-kitchen',
    name: 'Home & Kitchen',
    code: 'HOM',
    products: [
      p('Chef Knife', 6900, ['8 inch', '10 inch'], 'Forged stainless steel chef knife.'),
      p('Cast Iron Skillet', 3900, ['10 inch', '12 inch'], 'Pre-seasoned skillet for stovetop and oven.'),
      p('Pour-Over Coffee Maker', 2900, ['Glass'], 'Borosilicate glass coffee maker with a reusable filter.'),
      p('Electric Kettle', 4900, ['Steel', 'Matte Black'], 'Variable temperature kettle for tea and coffee.'),
      p('Cutting Board', 2400, ['Bamboo', 'Walnut'], 'Reversible board with a juice groove.'),
      p('Stand Mixer', 29900, ['Red', 'Cream'], 'Tilt-head mixer with a five-litre bowl.'),
      p('Linen Napkins', 1900, ['Natural', 'Charcoal'], 'Set of four stonewashed linen napkins.'),
    ],
  },
  {
    slug: 'outdoor',
    name: 'Outdoor',
    code: 'OUT',
    products: [
      p('Hiking Backpack', 11900, ['30 L', '45 L'], 'Lightweight pack with a ventilated back panel.'),
      p('Camping Tent', 18900, ['2 Person', '4 Person'], 'Freestanding tent with a full rain fly.'),
      p('Sleeping Bag', 8900, ['Regular', 'Long'], 'Three-season bag rated to minus five degrees.'),
      p('Headlamp', 2900, ['Standard'], 'Rechargeable headlamp with red night mode.'),
      p('Water Filter', 3900, ['Standard'], 'Squeeze filter that removes bacteria and protozoa.'),
      p('Trekking Poles', 7900, ['Standard'], 'Collapsible carbon poles with cork grips.'),
      p('Camp Stove', 5900, ['Standard'], 'Compact canister stove with a piezo igniter.'),
    ],
  },
  {
    slug: 'fitness',
    name: 'Fitness',
    code: 'FIT',
    products: [
      p('Yoga Mat', 3900, ['Purple', 'Green', 'Gray'], 'Non-slip mat, six millimetres thick.'),
      p('Adjustable Dumbbells', 24900, ['Pair'], 'Dumbbells that adjust from 2 to 24 kilograms.'),
      p('Resistance Bands', 1900, ['Set of 5'], 'Latex bands in five resistance levels.'),
      p('Foam Roller', 2400, ['Standard'], 'High-density roller for recovery.'),
      p('Jump Rope', 1400, ['Standard'], 'Speed rope with ball bearings.'),
      p('Fitness Tracker', 9900, ['Black', 'Rose'], 'Water-resistant tracker with heart-rate monitoring.'),
      p('Kettlebell', 4900, ['8 kg', '12 kg', '16 kg'], 'Cast iron kettlebell with a wide handle.'),
    ],
  },
  {
    slug: 'books',
    name: 'Books',
    code: 'BOK',
    products: [
      p('Designing Data-Intensive Applications', 4500, ['Paperback'], 'The big ideas behind reliable, scalable systems.'),
      p('The Pragmatic Programmer', 3900, ['Hardcover'], 'Your journey to mastery, 20th anniversary edition.'),
      p('Database Internals', 4900, ['Paperback'], 'A deep dive into how distributed data systems work.'),
      p('Refactoring', 4700, ['Hardcover'], 'Improving the design of existing code.'),
      p('Release It!', 4100, ['Paperback'], 'Design and deploy production-ready software.'),
      p('Clean Architecture', 3700, ['Paperback'], 'A craftsman guide to software structure and design.'),
      p('Site Reliability Engineering', 4400, ['Paperback'], 'How Google runs production systems.'),
    ],
  },
  {
    slug: 'toys-games',
    name: 'Toys & Games',
    code: 'TOY',
    products: [
      p('Strategy Board Game', 5400, ['Standard'], 'Trade and build in a two-to-four player classic.'),
      p('1000-Piece Puzzle', 1900, ['Mountains', 'City Lights'], 'Premium puzzle with a linen finish.'),
      p('Building Blocks Set', 7900, ['Standard'], 'Creative set with 900 pieces.'),
      p('Card Game', 1500, ['Standard'], 'Fast party game for three to eight players.'),
      p('Remote Control Car', 6900, ['Red', 'Blue'], 'Off-road car with a rechargeable battery.'),
      p('Chess Set', 4400, ['Wood'], 'Weighted pieces with a folding board.'),
      p('Drone Mini', 9900, ['Standard'], 'Beginner drone with altitude hold.'),
      p('Plush Bear', 2200, ['Brown', 'White'], 'Soft bear, 40 centimetres tall.'),
    ],
  },
  {
    slug: 'office',
    name: 'Office',
    code: 'OFF',
    products: [
      p('Desk Lamp', 4900, ['Black', 'White'], 'LED lamp with adjustable colour temperature.'),
      p('Notebook Set', 1600, ['Dotted', 'Lined'], 'Three A5 notebooks with lay-flat binding.'),
      p('Fountain Pen', 3400, ['Fine', 'Medium'], 'Steel-nib pen with a converter.'),
      p('Ergonomic Chair', 34900, ['Gray', 'Black'], 'Mesh chair with adjustable lumbar support.'),
      p('Standing Desk Mat', 5900, ['Standard'], 'Anti-fatigue mat with contoured edges.'),
      p('Monitor Arm', 8900, ['Single', 'Dual'], 'Gas-spring arm for screens up to 32 inches.'),
      p('Cable Organizer', 1200, ['Standard'], 'Under-desk tray that hides cables.'),
      p('Whiteboard', 6400, ['60x90 cm', '90x120 cm'], 'Magnetic dry-erase board with an aluminium frame.'),
    ],
  },
];
