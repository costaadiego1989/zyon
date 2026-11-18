export const adTermDefinitions={
 ROAS:'Compara as vendas informadas pela Meta com o gasto em anúncios. Um retorno de 4× significa R$ 4 em vendas para cada R$ 1 investido. Não é o lucro: ainda faltam os custos dos produtos, taxas e outras despesas.',
 ROI:'Mostra o ganho ou a perda em relação ao investimento, após considerar os custos. Um ganho de R$ 20 em um investimento de R$ 100 representa 20%. Para calcular, é preciso conhecer os custos; só o valor das vendas não basta.',
 CPA:'É o custo médio de cada resultado escolhido, como um pedido. Divide o gasto em anúncios pela quantidade desses resultados.',
 CPC:'É o custo médio de cada clique no anúncio: o gasto dividido pelo número de cliques.',
 CTR:'É a porcentagem de exibições que geraram cliques. Se 100 exibições geram 2 cliques, a taxa é 2%.',
 CPM:'É o custo para exibir o anúncio mil vezes. A mesma pessoa pode ver o anúncio mais de uma vez.',
} as const;
export function AdTermsHelp({text,label}:{text:string;label?:string}){
 const terms=(Object.keys(adTermDefinitions) as Array<keyof typeof adTermDefinitions>).filter(term=>new RegExp(`\\b${term}\\b`,'i').test(text));
 if(!terms.length)return null;
 return <details className={label?"mga-term-help mga-disclosure":"mga-term-help"}><summary>{label??`Entender os termos: ${terms.join(', ')}`}</summary><dl>{terms.map(term=><div key={term}><dt>{term}</dt><dd>{adTermDefinitions[term]}</dd></div>)}</dl></details>;
}
