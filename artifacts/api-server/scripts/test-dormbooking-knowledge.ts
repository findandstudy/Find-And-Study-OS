import test from "node:test";
import assert from "node:assert/strict";
import { buildDormBookingCatalogDocuments } from "../src/lib/inbox/dormBookingKnowledge.js";

test("DormBooking catalog creates one isolated RAG document per published dorm", () => {
  const result = buildDormBookingCatalogDocuments([
    {
      id: 10,
      name: "Central Female Residence",
      url: "https://dormbooking.com/st_yurt/central-female-residence/",
      city: "Istanbul",
      address: "Bagcilar, Istanbul",
      nearbyUniversities: ["Altinbas University"],
      facilities: ["Wi-Fi", "Security"],
      description: "Email: partner@example.com Phone: +90 555 111 22 33",
      rooms: [{
        id: 11,
        name: "Two Person Room",
        url: "https://dormbooking.com/hotel_room/two-person-room/",
        listedPrice: 4300,
        currency: "USD",
        priceBasis: null,
        adults: 2,
        beds: 2,
        facilities: ["Bunk Bed", "Mini Fridge"],
      }],
    },
    {
      id: 20,
      name: "Campus Residence",
      url: "https://dormbooking.com/st_yurt/campus-residence/",
      rooms: [],
    },
  ]);

  assert.equal(result.dormCount, 2);
  assert.equal(result.roomCount, 1);
  assert.equal(result.documents.length, 2);
  const central = result.documents.find((document) => document.dormId === 10)!;
  assert.deepEqual(central.nearbyUniversities, ["Altinbas University"]);
  assert.match(central.text, /USD 4,300 \(billing period not specified\)/);
  assert.match(central.text, /Never guarantee a room/);
  assert.match(central.text, /USD 100 Holding Fee/);
  assert.doesNotMatch(central.text, /Listed price: USD 4,300 \((monthly|yearly|per semester|per program)\)/i);
  assert.doesNotMatch(central.text, /partner@example\.com|555 111/);
  const campus = result.documents.find((document) => document.dormId === 20)!;
  assert.doesNotMatch(campus.text, /Two Person Room/);
});

test("DormBooking catalog rejects incomplete records and deduplicates public labels", () => {
  const result = buildDormBookingCatalogDocuments([
    { id: 1, name: "", url: "https://dormbooking.com/invalid" },
    { id: 2, name: "Valid Dorm", url: "https://dormbooking.com/valid", facilities: ["Wi-Fi", "Wi-Fi", ""] },
  ]);
  assert.equal(result.dormCount, 1);
  assert.match(result.text, /Dorm facilities: Wi-Fi/);
});
