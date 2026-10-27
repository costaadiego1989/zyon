import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useBuyerHub } from "../../../src/lib/viewmodels/useBuyerHub";

function Fixture() {
  const [open, setOpen] = useState(true);
  const [merchantId, setMerchantId] = useState("qa-store");
  const vm = useBuyerHub(open, merchantId);
  useEffect(() => { vm.setActiveTab("orders"); }, []);
  return <main>
    <button onClick={() => setOpen(!open)}>{open ? "Fechar conta" : "Abrir conta"}</button>
    <button onClick={() => setMerchantId("another-store")}>Outra loja</button>
    <button onClick={vm.signOut}>Sair</button>
    {open && vm.auth && <section aria-label="Pedidos">
      {vm.purchases.loading && <p role="status">Carregando pedidos</p>}
      {vm.purchases.error && <p role="alert">{vm.purchases.error}</p>}
      {vm.purchases.data?.map(purchase => <p key={purchase.id}>{purchase.items.map(item => item.name).join(", ")}</p>)}
      {!vm.purchases.loading && vm.purchases.data?.length === 0 && <p>Nenhum pedido</p>}
      <button disabled={vm.purchases.loading} onClick={() => { void vm.loadPurchases(true); }}>Atualizar pedidos</button>
      {vm.purchasesHasMore && <button disabled={vm.purchases.loading} onClick={() => { void vm.loadMorePurchases(); }}>Mais pedidos</button>}
    </section>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
