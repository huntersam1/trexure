import { describe, it, expect } from "vitest";
import { toCsv, csvRow, joinCsvBlocks, type CsvColumn } from "./csv";

type Row = { name: string; amount: number; note: string };

const columns: CsvColumn<Row>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "Amount", value: (r) => r.amount },
  { header: "Note", value: (r) => r.note },
];

describe("toCsv", () => {
  it("emits a header + CRLF-terminated rows", () => {
    const csv = toCsv(columns, [
      { name: "Alice", amount: 5, note: "ok" },
      { name: "Bob", amount: 10, note: "ok" },
    ]);
    expect(csv).toBe("Name,Amount,Note\r\nAlice,5,ok\r\nBob,10,ok");
  });

  it("returns just the header for an empty row set", () => {
    expect(toCsv(columns, [])).toBe("Name,Amount,Note");
  });

  it("quotes and escapes cells containing comma, quote, or newline", () => {
    const csv = toCsv(columns, [
      { name: "Doe, John", amount: 1, note: 'say "hi"' },
      { name: "multi\nline", amount: 2, note: "carriage\rreturn" },
    ]);
    expect(csv).toBe(
      'Name,Amount,Note\r\n"Doe, John",1,"say ""hi"""\r\n"multi\nline",2,"carriage\rreturn"',
    );
  });

  it("neutralizes formula-injection cells (leading = + - @ tab CR) with an apostrophe", () => {
    const csv = toCsv(columns, [
      { name: "=WEBSERVICE(1)", amount: 1, note: "@SUM(A1)" },
      { name: "-2+3", amount: 2, note: "+cmd" },
    ]);
    expect(csv).toBe("Name,Amount,Note\r\n'=WEBSERVICE(1),1,'@SUM(A1)\r\n'-2+3,2,'+cmd");
  });

  it("neutralizes then still quotes a formula cell that also contains a comma", () => {
    expect(csvRow(["=1,2"])).toBe(`"'=1,2"`);
  });

  it("renders null/undefined cells as empty strings", () => {
    const csv = toCsv<{ a: string | null; b: undefined }>(
      [
        { header: "A", value: (r) => r.a },
        { header: "B", value: (r) => r.b },
      ],
      [{ a: null, b: undefined }],
    );
    expect(csv).toBe("A,B\r\n,");
  });
});

describe("csvRow / joinCsvBlocks", () => {
  it("serializes a raw row", () => {
    expect(csvRow(["x", 1, null, "a,b"])).toBe('x,1,,"a,b"');
  });

  it("joins non-empty blocks with a blank line and drops empties", () => {
    expect(joinCsvBlocks(["a", "", "b"])).toBe("a\r\n\r\nb");
  });
});
