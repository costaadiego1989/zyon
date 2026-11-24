import {test,expect,type Response} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,protect,login,prefix,matches,api,snapshot,scoped,capture} from './service-appointment-journey-helpers.js';
import {boardFacts,historicalBoardFacts,boardSnapshot,boardHash,screenIds,states,labels,expectedCounts} from './service-appointments-board-helpers.js';
test.beforeEach(async({context,page})=>protect(context,page));

test('ATEND-11 six persisted states and separate finance share exact canonical IDs/counts in Kanban and list',async({page,request})=>{
  const seed=await fixture(request,'local'),facts=await boardFacts(request,seed),before=await boardSnapshot(request,seed),reads:Response[]=[];
  page.on('response',response=>{if(matches(response,prefix(seed)))reads.push(response);});
  await login(page,seed,boardHash(facts));
  await expect(page.getByText('7 de 7 agendamentos nesta página',{exact:true})).toBeVisible();
  const canonical=await reads.at(-1)!.json(),ids=[...Object.values(facts.boardIds),facts.secondaryAppointmentId].sort();
  expect(canonical.items.map((row:any)=>row.id).sort()).toEqual(ids);expect(canonical.totalCount).toBe(7);
  expect(canonical.countsByStatus).toEqual({pending:1,scheduled:2,in_service:1,completed:1,no_show:1,cancelled:1});
  expect(await screenIds(page)).toEqual(ids);expect(ids).not.toContain(facts.orderId);
  const board=page.getByRole('region',{name:'Quadro de agendamentos',exact:true});
  for(let index=0;index<states.length;index++){const status=states[index],column=board.locator(`[data-appointment-status="${status}"]`);await expect(column.getByRole('heading',{name:labels[index],exact:true})).toBeVisible();await expect(column.locator(`[data-appointment-id="${facts.boardIds[status]}"]`)).toHaveCount(1);expect(await column.locator('header span').textContent()).toBe(String(canonical.countsByStatus[status]));}
  await expect(page.locator(`[data-appointment-id="${facts.boardIds.scheduled}"]`).getByText('Pago',{exact:true})).toBeVisible();
  await expect(page.locator(`[data-appointment-id="${facts.boardIds.completed}"]`).getByText('A pagar no atendimento',{exact:true})).toBeVisible();
  await expect(page.locator(`[data-appointment-id="${facts.boardIds.pending}"]`).getByText('Sem registro de pagamento',{exact:true})).toBeVisible();
  await capture(page,board,'t103-actual-six-state-kanban');
  const readCount=reads.length;await page.getByRole('button',{name:'Lista',exact:true}).click();
  const list=page.getByRole('region',{name:'Lista de agendamentos',exact:true});await expect(list).toBeVisible();expect(await screenIds(page)).toEqual(ids);expect(reads).toHaveLength(readCount);
  for(let index=0;index<states.length;index++)await expect(list.locator(`[data-appointment-id="${facts.boardIds[states[index]]}"]`).getByText(labels[index],{exact:true})).toBeVisible();
  await expect(list.locator(`[data-appointment-id="${facts.boardIds.scheduled}"]`).getByText('Pago',{exact:true})).toBeVisible();await expect(list.locator(`[data-appointment-id="${facts.boardIds.completed}"]`).getByText('A pagar no atendimento',{exact:true})).toBeVisible();
  await capture(page,list,'t103-actual-six-state-list');expect(await boardSnapshot(request,seed)).toEqual(before);
});

test('ATEND-11 exact server cursors enumerate every canonical page once and refresh preserves the selected page',async({page,request})=>{
  const seed=await fixture(request,'local'),facts=await historicalBoardFacts(request,seed),before=await boardSnapshot(request,seed);
  const firstRead=page.waitForResponse(response=>matches(response,prefix(seed)));await login(page,seed);
  let canonical=await(await firstRead).json();expect(canonical.totalCount).toBeGreaterThan(25);expect(canonical.items).toHaveLength(25);
  const expected=before.appointments.filter(row=>Date.parse(row.startsAt)>=Date.parse(seed.baseDate+'T03:00:00Z')&&Date.parse(row.startsAt)<Date.parse(seed.toDate+'T03:00:00Z')+86400000),all:string[]=[];
  const total=canonical.totalCount;expect(total).toBe(expected.length);expect(canonical.countsByStatus).toEqual(expectedCounts(expected));
  for(let pageNumber=0;pageNumber<3;pageNumber++){
    await expect(page.locator('[data-appointment-id]')).toHaveCount(canonical.items.length);expect(await screenIds(page)).toEqual(canonical.items.map((row:any)=>row.id).sort());all.push(...canonical.items.map((row:any)=>row.id));
    if(!canonical.nextCursor)break;
    const cursor=canonical.nextCursor,next=page.waitForResponse(response=>matches(response,prefix(seed))&&new URL(response.url()).searchParams.get('cursor')===cursor);
    await page.getByRole('button',{name:'Próxima página',exact:true}).click();const response=await next;expect(response.status()).toBe(200);canonical=await response.json();expect(canonical.totalCount).toBe(total);expect(canonical.countsByStatus).toEqual(expectedCounts(expected));
  }
  expect(canonical.nextCursor).toBeNull();expect(all).toHaveLength(total);expect(new Set(all).size).toBe(total);expect(all.sort()).toEqual(expected.map(row=>row.id).sort());expect(all).not.toContain(facts.orderId);
  const selectedIds=await screenIds(page),refresh=page.waitForResponse(response=>matches(response,prefix(seed)));await page.getByRole('button',{name:'Atualizar',exact:true}).click();expect((await refresh).status()).toBe(200);await expect.poll(()=>screenIds(page)).toEqual(selectedIds);
  const first=page.waitForResponse(response=>matches(response,prefix(seed))&&!new URL(response.url()).searchParams.has('cursor'));await page.getByRole('button',{name:'Primeira página',exact:true}).click();const restored=await(await first).json();expect(restored.items).toHaveLength(25);await expect.poll(()=>screenIds(page)).toEqual(restored.items.map((row:any)=>row.id).sort());expect(await boardSnapshot(request,seed)).toEqual(before);
});

test('ATEND-11 period/professional/service/category/status gestures use the same server selector after refresh',async({page,request})=>{
  const seed=await fixture(request,'local'),facts=await boardFacts(request,seed),before=await boardSnapshot(request,seed);await login(page,seed);
  const products=page.waitForResponse(response=>matches(response,`/v1/merchants/${seed.merchant_id}/products`));await page.getByRole('button',{name:'Consultar serviços para filtrar',exact:true}).click();expect((await products).status()).toBe(200);
  await page.getByLabel('De',{exact:true}).fill(facts.date);await page.getByLabel('Até',{exact:true}).fill(facts.date);await page.getByLabel('Profissional',{exact:true}).selectOption(facts.secondaryProfessionalId);await page.getByLabel('Serviço',{exact:true}).selectOption(facts.secondaryProductId);await page.getByLabel('Categoria',{exact:true}).selectOption(seed.categoryId);await page.getByLabel('Etapa do atendimento',{exact:true}).selectOption('scheduled');
  const filtered=page.waitForResponse(response=>matches(response,prefix(seed))&&new URL(response.url()).searchParams.get('productId')===facts.secondaryProductId);await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();const reply=await filtered;expect(reply.status()).toBe(200);const query=new URL(reply.url()).searchParams;
  expect(Object.fromEntries(query)).toEqual({fromDate:facts.date,toDate:facts.date,professionalId:facts.secondaryProfessionalId,categoryId:seed.categoryId,productId:facts.secondaryProductId,status:'scheduled'});expect(query.has('cursor')).toBe(false);
  const data=await reply.json();expect(data.timeZone).toBe('America/Sao_Paulo');expect(data.totalCount).toBe(1);expect(data.items.map((row:any)=>row.id)).toEqual([facts.secondaryAppointmentId]);expect(data.countsByStatus).toEqual({pending:0,scheduled:1,in_service:0,completed:0,no_show:0,cancelled:0});await expect.poll(()=>screenIds(page)).toEqual([facts.secondaryAppointmentId]);
  await page.getByRole('button',{name:'Lista',exact:true}).click();expect(await screenIds(page)).toEqual([facts.secondaryAppointmentId]);const hash=await page.evaluate(()=>location.hash);
  const reloaded=page.waitForResponse(response=>matches(response,prefix(seed))&&new URL(response.url()).searchParams.get('productId')===facts.secondaryProductId);await page.reload();expect((await reloaded).status()).toBe(200);expect(await page.evaluate(()=>location.hash)).toBe(hash);await expect(page.getByLabel('Serviço',{exact:true})).toHaveValue(facts.secondaryProductId);await expect.poll(()=>screenIds(page)).toEqual([facts.secondaryAppointmentId]);expect(await boardSnapshot(request,seed)).toEqual(before);
});

test('ATEND-11 mobile keyboard detail and a real stale command preserve prior version/finance until explicit reload',async({page,request})=>{
  const seed=await fixture(request,'local'),facts=await boardFacts(request,seed),id=facts.boardIds.scheduled;await page.setViewportSize({width:390,height:844});await login(page,seed,boardHash(facts));await page.getByRole('button',{name:'Lista',exact:true}).click();
  const opener=page.locator(`[data-appointment-id="${id}"]`).getByRole('button',{name:/Abrir agendamento/});await opener.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Detalhes do agendamento',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Iniciar atendimento',exact:true})).toBeVisible();await expect(dialog.getByText('Pagamento recebido',{exact:true})).toBeVisible();
  const original=scoped(await snapshot(request,seed),id),externalId=randomUUID();await api(request,seed,`/merchants/${seed.merchant_id}/service-appointments/${id}/transitions`,'POST',{commandId:externalId,expectedVersion:original.appointment.version,action:'start_service'});
  const before=scoped(await snapshot(request,seed),id);expect(before.appointment.version).toBe(original.appointment.version+1);expect(before.appointment.status).toBe('in_service');const commands:any[]=[];page.on('request',value=>{if(value.method()==='POST'&&new URL(value.url()).pathname===`${prefix(seed)}/${id}/transitions`)commands.push(value.postDataJSON());});
  const rejected=page.waitForResponse(response=>matches(response,`${prefix(seed)}/${id}/transitions`,'POST'));await dialog.getByRole('button',{name:'Registrar ausência',exact:true}).click();expect((await rejected).status()).toBe(409);expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({expectedVersion:original.appointment.version,action:'no_show'});expect(commands[0].commandId).toBeTruthy();await expect(dialog.getByText(/Confira os dados atuais/)).toBeVisible();await expect(dialog.getByText('Agendado',{exact:true})).toBeVisible();expect(scoped(await snapshot(request,seed),id)).toEqual(before);
  await dialog.getByRole('button',{name:'Recarregar detalhes',exact:true}).click();await expect(dialog.getByRole('button',{name:'Concluir atendimento',exact:true})).toBeVisible();await expect(dialog.getByText('Em atendimento',{exact:true})).toBeVisible();expect(commands).toHaveLength(1);expect(scoped(await snapshot(request,seed),id)).toEqual(before);
  const done=page.waitForResponse(response=>matches(response,`${prefix(seed)}/${id}/transitions`,'POST'));await dialog.getByRole('button',{name:'Concluir atendimento',exact:true}).focus();await page.keyboard.press('Enter');expect((await done).status()).toBe(201);await expect(dialog.getByText('Concluído',{exact:true})).toBeVisible();expect(commands).toHaveLength(2);expect(commands[1].expectedVersion).toBe(before.appointment.version);
  const after=scoped(await snapshot(request,seed),id);expect(after.appointment.status).toBe('completed');expect(after.appointment.version).toBe(before.appointment.version+1);expect(after.payments).toEqual(before.payments);expect(after.receipts).toEqual(before.receipts);expect(after.stock).toEqual(before.stock);expect(after.audits.filter(row=>row.commandId===commands[1].commandId)).toHaveLength(1);await capture(page,dialog.getByRole('heading',{name:'Pagamento',exact:true}),'t103-actual-mobile-keyboard-conflict');
});
