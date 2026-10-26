import type { Recipe, StationKind } from "./schemas.ts";

/**
 * Demo seed data. All product names, recipes and SKUs are invented for this
 * demo; they are not any real company's recipes or workflow.
 */
export const DEMO_STORE = { name: "Edible KDS Demo Kitchen", timezone: "America/Chicago" };

export const DEMO_STATIONS: { name: string; kind: StationKind }[] = [
  { name: "Fruit Prep", kind: "FRUIT" },
  { name: "Chocolate", kind: "CHOCOLATE" },
  { name: "Assembly", kind: "ASSEMBLY" },
  { name: "Packaging", kind: "PACKAGING" },
];

export const DEMO_PASSWORD = "Demo-Pass-2026!";

export const DEMO_USERS = [
  { email: "admin@ediblekds.demo", name: "Avery Admin", role: "ADMIN" },
  { email: "manager@ediblekds.demo", name: "Morgan Manager", role: "MANAGER" },
  { email: "qc@ediblekds.demo", name: "Quinn QC", role: "QC" },
  { email: "associate1@ediblekds.demo", name: "Alex Associate", role: "ASSOCIATE" },
  { email: "associate2@ediblekds.demo", name: "Sam Associate", role: "ASSOCIATE" },
] as const;

export const DEMO_PRODUCTS: { sku: string; name: string; recipe: Recipe }[] = [
  {
    sku: "SB-01",
    name: "Sunrise Bouquet",
    recipe: {
      components: ["Cantaloupe stars", "Pineapple daisies", "Grapes", "Kale base"],
      allergens: [],
      steps: [
        { key: "melon", name: "Cut cantaloupe stars", stationKind: "FRUIT", durationSec: 240, dependsOn: [], instructions: "Star cutter, 1 cm thick. 8 pieces." },
        { key: "pineapple", name: "Cut pineapple daisies", stationKind: "FRUIT", durationSec: 300, dependsOn: [], instructions: "Daisy cutter. 10 pieces, add grape centers." },
        { key: "assemble", name: "Assemble bouquet", stationKind: "ASSEMBLY", durationSec: 360, dependsOn: ["melon", "pineapple"], instructions: "Kale base, tallest skewers at the center." },
        { key: "package", name: "Wrap and label", stationKind: "PACKAGING", durationSec: 120, dependsOn: ["assemble"], instructions: "Clear wrap, ribbon, print label." },
      ],
    },
  },
  {
    sku: "DB-12",
    name: "Dipped Berry Box (12)",
    recipe: {
      components: ["Strawberries", "Semisweet chocolate", "White drizzle"],
      allergens: ["MILK", "SOY"],
      steps: [
        { key: "wash", name: "Wash and dry strawberries", stationKind: "FRUIT", durationSec: 180, dependsOn: [], instructions: "Pat completely dry; water seizes chocolate." },
        { key: "dip", name: "Dip strawberries", stationKind: "CHOCOLATE", durationSec: 300, dependsOn: ["wash"], instructions: "Semisweet, 2/3 coverage." },
        { key: "drizzle", name: "Drizzle and set", stationKind: "CHOCOLATE", durationSec: 240, dependsOn: ["dip"], instructions: "White drizzle; chill for 3 minutes." },
        { key: "box", name: "Box 12 count", stationKind: "PACKAGING", durationSec: 90, dependsOn: ["drizzle"], instructions: "Gift box, insert liner." },
      ],
    },
  },
  {
    sku: "GC-XL",
    name: "Grand Celebration (XL)",
    recipe: {
      components: ["Pineapple daisies", "Honeydew", "Dipped strawberries", "Dipped apple wedges", "Balloon", "Card"],
      allergens: ["MILK", "SOY", "TREE_NUTS"],
      steps: [
        { key: "pineapple", name: "Cut pineapple daisies", stationKind: "FRUIT", durationSec: 300, dependsOn: [], instructions: "14 daisies." },
        { key: "honeydew", name: "Cut honeydew wedges", stationKind: "FRUIT", durationSec: 240, dependsOn: [], instructions: "" },
        { key: "berries", name: "Wash strawberries", stationKind: "FRUIT", durationSec: 180, dependsOn: [], instructions: "" },
        { key: "dip-berries", name: "Dip strawberries", stationKind: "CHOCOLATE", durationSec: 300, dependsOn: ["berries"], instructions: "" },
        { key: "dip-apples", name: "Dip apples + almond crunch", stationKind: "CHOCOLATE", durationSec: 360, dependsOn: [], instructions: "Tree nut topping; use the nut-only tray." },
        { key: "assemble", name: "Assemble XL arrangement", stationKind: "ASSEMBLY", durationSec: 600, dependsOn: ["pineapple", "honeydew", "dip-berries", "dip-apples"], instructions: "" },
        { key: "finish", name: "Add balloon and card", stationKind: "ASSEMBLY", durationSec: 120, dependsOn: ["assemble"], instructions: "" },
        { key: "package", name: "Wrap and label XL", stationKind: "PACKAGING", durationSec: 180, dependsOn: ["finish"], instructions: "" },
      ],
    },
  },
  {
    sku: "FC-3",
    name: "Fruit Cup Trio",
    recipe: {
      components: ["Mixed fruit", "Cups x3"],
      allergens: [],
      steps: [
        { key: "cut", name: "Cut mixed fruit", stationKind: "FRUIT", durationSec: 240, dependsOn: [], instructions: "Melon, pineapple and grapes. 3 cups." },
        { key: "cup", name: "Cup, lid and label", stationKind: "PACKAGING", durationSec: 90, dependsOn: ["cut"], instructions: "" },
      ],
    },
  },
];
