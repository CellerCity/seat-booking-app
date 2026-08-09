import { describe, expect, it } from "vitest";
import { filterPeople, matchesSearch, type SearchablePerson } from "./people-search";

const aman: SearchablePerson = {
  name: "Aman Nasim",
  phone: "+919876543210",
  affiliation: "Physics",
  joiningYear: 2024,
};

const priya: SearchablePerson = {
  name: "Priya Rao",
  phone: "+917012345678",
  affiliation: "Chemistry",
  joiningYear: 2022,
};

describe("matchesSearch", () => {
  it("treats an empty query as no filter at all", () => {
    expect(matchesSearch(aman, "")).toBe(true);
    expect(matchesSearch(aman, "   ")).toBe(true);
  });

  it("finds a person by any part of their name, in any case", () => {
    expect(matchesSearch(aman, "aman")).toBe(true);
    expect(matchesSearch(aman, "NASIM")).toBe(true);
    expect(matchesSearch(aman, "asi")).toBe(true);
    expect(matchesSearch(aman, "priya")).toBe(false);
  });

  it("finds a person by their number however it is typed", () => {
    // The point of the whole module: the coordinator has the number on screen
    // in one format and the roster stores it in another.
    expect(matchesSearch(aman, "9876543210")).toBe(true);
    expect(matchesSearch(aman, "+919876543210")).toBe(true);
    expect(matchesSearch(aman, "98765 43210")).toBe(true);
    expect(matchesSearch(aman, "98765-43210")).toBe(true);
    expect(matchesSearch(aman, "09876543210")).toBe(true);
    expect(matchesSearch(aman, "919876543210")).toBe(true);
  });

  it("matches a partial number, so typing can stop as soon as it is unique", () => {
    expect(matchesSearch(aman, "9876")).toBe(true);
    expect(matchesSearch(aman, "43210")).toBe(true);
    expect(matchesSearch(priya, "9876")).toBe(false);
  });

  it("narrows with each extra word rather than widening", () => {
    // Every token must match. Otherwise a second word could only ever pull in
    // more people, which is the opposite of what typing more means.
    expect(matchesSearch(aman, "aman 9876")).toBe(true);
    expect(matchesSearch(aman, "aman 7012")).toBe(false);
    expect(matchesSearch(aman, "aman priya")).toBe(false);
  });

  it("searches affiliation too", () => {
    expect(matchesSearch(aman, "physics")).toBe(true);
    expect(matchesSearch(aman, "chem")).toBe(false);
  });

  it("picks out a batch by its full year", () => {
    expect(matchesSearch(aman, "2024")).toBe(true);
    expect(matchesSearch(priya, "2024")).toBe(false);
    // A prefix must not: "20" would otherwise return everyone.
    expect(matchesSearch({ ...aman, phone: "+915555555555" }, "20")).toBe(false);
  });

  it("copes with the fields that are allowed to be missing", () => {
    const bare: SearchablePerson = { name: "Sam", phone: "+919000000001" };
    expect(matchesSearch(bare, "sam")).toBe(true);
    expect(matchesSearch(bare, "9000")).toBe(true);
    expect(matchesSearch(bare, "2024")).toBe(false);
  });
});

describe("filterPeople", () => {
  it("keeps the order it was given", () => {
    const people = [aman, priya, { ...aman, name: "Aman Verma" }];
    expect(filterPeople(people, "aman").map((p) => p.name)).toEqual([
      "Aman Nasim",
      "Aman Verma",
    ]);
  });

  it("returns everyone when nothing is typed", () => {
    expect(filterPeople([aman, priya], "  ")).toHaveLength(2);
  });
});
