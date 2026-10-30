import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { Module, forwardRef } from "@nestjs/common";
import { NOTIFICATION_WHATSAPP_SENDER } from "./application/ports/notification-whatsapp-sender.port.js";
import { OrderNotificationWhatsAppAdapter } from "./infrastructure/adapters/order-notification-whatsapp.adapter.js";

test("notification module binds the transactional Meta port without starting an app or worker", () => {
  const sourceText = fs.readFileSync(new URL("./notifications.module.ts", import.meta.url), "utf8");
  const source = ts.createSourceFile("notifications.module.ts", sourceText, ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find(ts.isClassDeclaration)!;
  const decorator = ts.getDecorators(declaration)!.find(entry => ts.isCallExpression(entry.expression) && entry.expression.expression.getText(source) === "Module")!;
  const expression = decorator.expression as ts.CallExpression;
  const dependencies: Record<string, unknown> = { Module, forwardRef, NOTIFICATION_WHATSAPP_SENDER, OrderNotificationWhatsAppAdapter };
  for (const entry of source.statements.filter(ts.isImportDeclaration)) {
    const bindings = entry.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const { name } of bindings.elements) {
      if (!(name.text in dependencies)) dependencies[name.text] = /^[A-Z0-9_]+$/.test(name.text)
        ? Symbol(name.text) : Object.defineProperty(function () {}, "name", { value: name.text });
    }
  }
  const definition = vm.runInNewContext("(" + expression.arguments[0].getText(source) + ")", dependencies, { timeout: 1000 });
  class MetadataOnlyModule {}
  Module(definition)(MetadataOnlyModule);
  const providers = Reflect.getMetadata("providers", MetadataOnlyModule);
  const matches = providers.filter((provider: any) => provider.provide === NOTIFICATION_WHATSAPP_SENDER);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].useClass, OrderNotificationWhatsAppAdapter);
  assert.ok(Reflect.getMetadata("imports", MetadataOnlyModule).some((entry: any) => entry.name === "WhatsAppTemplatesModule"));
});
