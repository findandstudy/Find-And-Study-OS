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
      accommodationTypes: ["Female - Dorm"],
      facilities: ["Wi-Fi", "Security"],
      description: "Email: partner@example.com Phone: +90 555 111 22 33",
      rooms: [{
        id: 11,
        name: "Two Person Room",
        url: "https://dormbooking.com/hotel_room/two-person-room/",
        listedPrice: 4300,
        currency: "USD",
        feePeriod: "academic year",
        holdingFee: 300,
        deposit: 500,
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
  assert.match(central.text, /Accommodation price: USD 4,300 \(academic year\)/);
  assert.match(central.text, /Gender eligibility: Female only/);
  assert.doesNotMatch(central.text, /Male and female/);
  assert.match(central.text, /Holding Fee: USD 300/);
  assert.match(central.text, /Never guarantee a room/);
  assert.doesNotMatch(central.text, /USD 100 Holding Fee/);
  assert.doesNotMatch(central.text, /partner@example\.com|555 111/);
  const campus = result.documents.find((document) => document.dormId === 20)!;
  assert.doesNotMatch(campus.text, /Two Person Room/);
});

test("DormBooking catalog withholds incomplete pricing and quarantines known gender errors", () => {
  const result = buildDormBookingCatalogDocuments([
    {
      id: 30,
      name: "Incomplete Price Dorm",
      url: "https://dormbooking.com/incomplete",
      rooms: [{ id: 31, name: "Room", listedPrice: 2000, currency: "USD" }],
    },
    {
      id: 40,
      name: "Istanbul Medipol University Male Student Dormitory",
      url: "https://dormbooking.com/quarantined",
    },
  ]);
  assert.equal(result.dormCount, 1);
  assert.match(result.text, /PRICE STATUS: Incomplete/);
  assert.doesNotMatch(result.text, /Accommodation price: USD 2,000/);
  assert.doesNotMatch(result.text, /Medipol/);
});

test("DormBooking catalog rejects incomplete records and deduplicates public labels", () => {
  const result = buildDormBookingCatalogDocuments([
    { id: 1, name: "", url: "https://dormbooking.com/invalid" },
    { id: 2, name: "Valid Dorm", url: "https://dormbooking.com/valid", facilities: ["Wi-Fi", "Wi-Fi", ""] },
  ]);
  assert.equal(result.dormCount, 1);
  assert.match(result.text, /Dorm facilities: Wi-Fi/);
});
