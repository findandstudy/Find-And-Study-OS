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
      description: "Check In: 01/09/2026 Check Out: 30/06/2027 Contract Instalment Plan: August arrivals may pay the remaining balance in three instalments. Email: partner@example.com Phone: +90 555 111 22 33",
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
  assert.match(central.text, /"net_accommodation_fee":4000/);
  assert.match(central.text, /"advance_payment_30":1200/);
  assert.match(central.text, /"remaining_payment_70":2800/);
  assert.match(central.text, /"contract_start":"2026-09-01"/);
  assert.match(central.text, /"contract_end":"2027-06-30"/);
  assert.match(central.text, /August arrivals may pay the remaining balance in three instalments/);
  assert.match(central.text, /Never guarantee a room/);
  assert.doesNotMatch(central.text, /USD 100 Holding Fee/);
  assert.doesNotMatch(central.text, /partner@example\.com|555 111/);
  const campus = result.documents.find((document) => document.dormId === 20)!;
  assert.doesNotMatch(campus.text, /Two Person Room/);
});

test("DormBooking catalog quotes non-null prices, exposes missing fields and quarantines known gender errors", () => {
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
  assert.doesNotMatch(result.text, /PRICE STATUS: price is null/);
  assert.match(result.text, /Accommodation price: USD 2,000/);
  assert.doesNotMatch(result.text, /Medipol/);
  assert.match(result.text, /"price":2000/);
  assert.match(result.text, /"fee_period":null/);
  assert.deepEqual(result.incompletePriceFields, {
    fee_period: 1,
    holding_fee: 1,
    contract_start: 1,
    contract_end: 1,
    instalment_plan: 1,
  });
  assert.equal(result.suppressedDormCount, 1);
});

test("DormBooking catalog filters explicit suppression and corrects the Yalova city", () => {
  const result = buildDormBookingCatalogDocuments([
    { id: 50, name: "Hidden Residence", url: "https://dormbooking.com/hidden", suppressed: true },
    { id: 51, name: "Private Yalova Evim Male Student Dormitory", url: "https://dormbooking.com/yalova", city: "Istanbul" },
  ]);
  assert.equal(result.suppressedDormCount, 1);
  assert.doesNotMatch(result.text, /Hidden Residence/);
  assert.match(result.text, /City: Yalova/);
});

test("DormBooking catalog rejects incomplete records and deduplicates public labels", () => {
  const result = buildDormBookingCatalogDocuments([
    { id: 1, name: "", url: "https://dormbooking.com/invalid" },
    { id: 2, name: "Valid Dorm", url: "https://dormbooking.com/valid", facilities: ["Wi-Fi", "Wi-Fi", ""] },
  ]);
  assert.equal(result.dormCount, 1);
  assert.match(result.text, /Dorm facilities: Wi-Fi/);
});

test("DormBooking catalog derives the published payment plan from the room name", () => {
  const result = buildDormBookingCatalogDocuments([{
    id: 60,
    name: "Academic House",
    url: "https://dormbooking.com/academic-house",
    description: "Check In: 15/09/2026 Check Out: 15/06/2027 Contract",
    rooms: [{
      id: 61,
      name: "Five Person Room | 10-Monthly Installment Payment",
      listedPrice: 5750,
      currency: "USD",
    }],
  }]);
  assert.match(result.text, /"contract_start":"2026-09-15"/);
  assert.match(result.text, /"contract_end":"2027-06-15"/);
  assert.match(result.text, /"instalment_plan":\["10-Monthly Installment Payment"\]/);
});

test("DormBooking catalog never copies a dorm-level instalment plan onto every room", () => {
  const result = buildDormBookingCatalogDocuments([{
    id: 70,
    name: "Mixed Payment Dorm",
    url: "https://dormbooking.com/mixed-payment",
    description: "Instalment Plan: Some selected rooms may offer instalments.",
    rooms: [
      { id: 71, name: "Single Room | Advance Payment", listedPrice: 6000, currency: "USD" },
      { id: 72, name: "Double Room | 3 Installment", listedPrice: 5000, currency: "USD" },
    ],
  }]);
  assert.deepEqual(result.documents[0]?.rooms[0]?.instalmentPlan, ["Advance Payment"]);
  assert.deepEqual(result.documents[0]?.rooms[1]?.instalmentPlan, ["3 Installment"]);
  assert.doesNotMatch(JSON.stringify(result.documents[0]?.rooms), /Some selected rooms/);
});
