import assert from "node:assert/strict";
import test from "node:test";
import {PrismaClient} from "@prisma/client";
import {createDisposablePostgres} from "./local-disposable-postgres.mjs";
import {bootstrapServiceSchema,migrationName} from "./service-migration-bootstrap.mjs";
import {assertServiceArtifacts} from "./service-test-artifacts.mjs";
import {SERVICE_LOCAL_TEST_MS} from "./service-test-startup.mjs";
import {composeOwnedSourceServiceRelease} from "./service-release-source-process.fixture.js";
import {composeOwnedDistServiceRelease} from "./service-release-dist-process.fixture.mjs";
import * as sourceArtifact from "../src/shared/bookings/service-release-artifact.js";
import {serviceActivationReadinessWithin as sourceReadiness} from "../src/shared/bookings/service-activation-readiness.js";

test("T94 real owned ledger and separate source/dist process preconditions",{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  assertServiceArtifacts();const db=await createDisposablePostgres({transport:"loopback-exec"});let prisma:PrismaClient|undefined,sourceScope:any,distScope:any;
  try{
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);prisma=new PrismaClient({datasources:{db:{url:db.prismaUrl}}});const p=prisma;
    await p.merchant.create({data:{id:"release-process-owned",name:"Synthetic direct release scope",businessMode:"services",businessModeSelectedAt:new Date()}});
    await p.serviceBusinessPolicy.create({data:{merchantId:"release-process-owned",version:1,configuredAt:new Date(),admissionsEnabled:true,holdEnabled:false,paymentMode:"at_attendance"}});
    const distArtifact=await import("../dist/shared/bookings/service-release-artifact.js"),{serviceActivationReadinessWithin:distReadiness}=await import("../dist/shared/bookings/service-activation-readiness.js");
    const read=(reader:typeof sourceReadiness)=>p.$transaction(tx=>reader(tx,"release-process-owned"));
    await t.test("matching source plus missing dist stay separate under the actual SQL guard",async()=>{
      sourceScope=composeOwnedSourceServiceRelease("matching");distScope=composeOwnedDistServiceRelease("missing");
      assert.equal(sourceArtifact.currentServiceReleaseArtifact(),sourceScope.owner);assert.equal(distArtifact.currentServiceReleaseArtifact(),distScope.owner);
      assert.deepEqual(await read(sourceReadiness),{ready:true,blockers:[],policyVersion:1});
      assert.deepEqual(await read(distReadiness),{ready:false,blockers:["release_manifest_missing"],policyVersion:1});
      assert.equal(sourceScope.evidence.releaseProof,"not_proven");assert.equal(distScope.evidence.frontendServing,"not_proven");
    });
    await t.test("each namespace measures the same actual owned payload and independently verifies the applied ledger",async()=>{
      distScope.close();distScope=composeOwnedDistServiceRelease("matching");
      assert.deepEqual(await read(distReadiness),{ready:true,blockers:[],policyVersion:1});
      assert.equal(distScope.evidence.payloadSha256,sourceScope.evidence.payloadSha256);assert.equal(distScope.evidence.sourceInputSha256,sourceScope.evidence.sourceInputSha256);
      assert.equal(await p.serviceAppointment.count(),0);assert.equal(await p.paymentIntent.count(),0);assert.equal(await p.inventoryMovement.count(),0);
    });
    await t.test("a genuine mismatching applied migration still blocks both namespaces without business mutations",async()=>{
      const before=await p.$queryRaw<Array<{checksum:string}>>`SELECT checksum FROM _prisma_migrations WHERE migration_name=${migrationName}`;assert.equal(before.length,1);
      try{
        await p.$executeRaw`UPDATE _prisma_migrations SET checksum=${"0".repeat(64)} WHERE migration_name=${migrationName}`;
        for(const reader of [sourceReadiness,distReadiness])assert.deepEqual(await read(reader),{ready:false,blockers:["migration_incompatible"],policyVersion:1});
        assert.equal(await p.serviceAppointment.count(),0);assert.equal(await p.appointmentPayment.count(),0);assert.equal(await p.inventoryMovement.count(),0);
      }finally{await p.$executeRaw`UPDATE _prisma_migrations SET checksum=${before[0].checksum} WHERE migration_name=${migrationName}`;}
      assert.deepEqual(await read(sourceReadiness),{ready:true,blockers:[],policyVersion:1});
    });
  }finally{distScope?.close();sourceScope?.close();if(prisma)await prisma.$disconnect();await db.dispose();assert.deepEqual(db.bridgeStatus(),{listening:false,sockets:0,children:0});}
});
