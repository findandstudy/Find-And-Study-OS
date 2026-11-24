import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { MERITO_PILOT_EXPECTED, parsePartnerProgramWorkbook } from "./programPriceWorkbook";

describe("partner price-list adapters", () => {
  it("normalizes the 13-row Merito pilot without converting PLN or inventing unverified fields", () => {
    const programRows: unknown[][] = Array.from({ length: 21 }, () => []);
    programRows[3] = ["", "WSB Merito Gdańsk", "", "WSB Merito Gdynia"];
    programRows[5] = ["", "BACHELOR PROGRAMS/ENGINEERING PROGRAMS"];
    for (let index = 0; index < 4; index++) programRows[6 + index] = ["", `Gdańsk Bachelor ${index + 1}`, `${10_121 + index} PLN`];
    programRows[14] = ["", "MASTER'S DEGREE", "", "MASTER'S DEGREE"];
    for (let index = 0; index < 6; index++) programRows[15 + index] = ["", `Gdańsk Master ${index + 1}`, `${13_073 + index} PLN`];
    for (let index = 0; index < 3; index++) {
      programRows[15 + index][3] = `Gdynia Master ${index + 1}`;
      programRows[15 + index][4] = `${10_121 + index} PLN`;
    }
    const termRows = [
      ["DEADLINES", "March 2027 intake start", "March 2027 intake end"],
      ["WSB Merito Gdańsk", "9/1/26", "3/11/27"],
      ["WSB Merito Gdynia", "9/1/26", "3/11/27"],
    ];
    const feeRows = [
      ["WSB Merito Gdańsk", "", "WSB Merito Gdynia", ""],
      ["Admission fee", "85 PLN", "Admission fee", "85 PLN"],
      ["Adaptation fee", "400 PLN", "Adaptation fee", "400 PLN"],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(programRows), "Programs");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(termRows), "Terms");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(feeRows), "Fees");

    const rows = parsePartnerProgramWorkbook(XLSX, workbook);
    assert.equal(rows.length, MERITO_PILOT_EXPECTED.programs);
    assert.deepEqual(new Set(rows.map(row => row.currency)), new Set([MERITO_PILOT_EXPECTED.currency]));
    assert.deepEqual(new Set(rows.map(row => row.applicationFee)), new Set([MERITO_PILOT_EXPECTED.applicationFee]));
    assert.deepEqual(new Set(rows.map(row => row.adaptationFee)), new Set([MERITO_PILOT_EXPECTED.adaptationFee]));
    assert.deepEqual(new Set(rows.map(row => row.commissionRate)), new Set([MERITO_PILOT_EXPECTED.commissionRate]));
    assert.equal(rows.every(row => row.enrollmentFee === "" && row.refundProcess === ""), true);
    assert.equal(rows.every(row => !row.tuitionFee.includes("€") && Number(row.tuitionFee) > 0), true);
  });
});
