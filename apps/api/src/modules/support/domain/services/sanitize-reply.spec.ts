import test from "node:test";
import assert from "node:assert/strict";
import { stripHtmlFromReply } from "./sanitize-reply.js";

test("stripHtmlFromReply leaves plain text untouched", () => {
  assert.equal(stripHtmlFromReply("Hello, customer!"), "Hello, customer!");
  assert.equal(stripHtmlFromReply("  trimmed  "), "trimmed");
});

test("stripHtmlFromReply removes inline HTML tags", () => {
  assert.equal(
    stripHtmlFromReply("Please <b>do not</b> panic about your <a href=\"x\">order</a>"),
    "Please do not panic about your order"
  );
});

test("stripHtmlFromReply strips entire script and style blocks", () => {
  assert.equal(
    stripHtmlFromReply("hello<script>alert('xss')</script>world"),
    "helloworld"
  );
  assert.equal(
    stripHtmlFromReply("intro<style>p { color: red }</style>outro"),
    "introoutro"
  );
  assert.equal(
    stripHtmlFromReply("a<script src=x></script>b<style>foo</style>c"),
    "abc"
  );
});

test("stripHtmlFromReply handles uppercase tag names and multiline payloads", () => {
  assert.equal(
    stripHtmlFromReply(
      "Intro\n<DIV class='evil'>content</DIV>\nmore <Span>nested</Span>"
    ),
    "Intro\ncontent\nmore nested"
  );
});

test("stripHtmlFromReply trims surrounding whitespace after stripping", () => {
  assert.equal(stripHtmlFromReply("   <b>safe</b>   "), "safe");
});

test("stripHtmlFromReply keeps ampersands and other entities intact", () => {
  assert.equal(
    stripHtmlFromReply("Delivery & payment updates are live."),
    "Delivery & payment updates are live."
  );
});
