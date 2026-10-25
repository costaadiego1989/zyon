import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.zyon-payments.com.br";
const published = "2026-10-07";

const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const paragraphs = (items) => items.map((item) => `<p>${item}</p>`).join("\n");
const list = (items) => `<ol class="authority-steps">${items.map((item) => `<li>${item}</li>`).join("\n")}</ol>`;
const questions = (items) => items.map(({ question, answer }) => `<h3>${question}</h3><p>${answer}</p>`).join("\n");

const articles = [
  {
    slug: "plataforma-ecommerce-com-ia",
    title: "Plataforma de e-commerce com IA: como criar sua loja virtual | Zyon",
    description: "Entenda o que avaliar em uma plataforma de e-commerce com IA e como criar uma loja virtual profissional com catálogo, atendimento, carrinho e checkout conectados.",
    headline: "Plataforma de e-commerce com IA para criar uma loja que orienta e vende.",
    lede: "Uma loja virtual com inteligência artificial pode reduzir o esforço de escolha do cliente. O que importa é conectar a conversa ao catálogo, às condições da operação e ao checkout — sem tirar da empresa o controle sobre a venda.",
    figure: "assets/engine-core.webp",
    alt: "Camadas que representam catálogo, regras comerciais e checkout conectados em uma plataforma de e-commerce com IA",
    type: "Guia de plataforma",
    minutes: "9 min de leitura",
    toc: [
      ["o-que-e", "O que uma plataforma com IA precisa conectar"],
      ["criar-loja", "Como criar loja virtual com IA"],
      ["escolher", "Como escolher a plataforma"],
      ["operacao", "O que a empresa continua controlando"],
      ["perguntas", "Perguntas frequentes"],
    ],
    sections: [
      {
        id: "o-que-e",
        title: "O que uma plataforma de e-commerce com IA precisa conectar",
        body: [
          "Uma plataforma de e-commerce com IA não é apenas uma vitrine com um chat. Ela reúne a apresentação da marca, o catálogo, o atendimento, o carrinho e o checkout para que uma dúvida possa virar uma decisão de compra sem o cliente recomeçar a jornada a cada etapa.",
          "A inteligência artificial entra para interpretar o que a pessoa procura, recuperar informações confiáveis da loja e apresentar alternativas relevantes. Preço, disponibilidade, desconto, frete e confirmação precisam continuar ligados às fontes e às regras da operação.",
        ],
        note: "Uma boa conversa comercial só funciona quando a resposta e a condição apresentada são sustentadas pelo que a loja realmente pode vender.",
      },
      {
        id: "criar-loja",
        title: "Como criar loja virtual com IA sem separar a jornada do cliente",
        body: [
          "Criar uma loja virtual com IA começa pelo básico que sustenta a venda: produtos bem organizados, informações que ajudam a comparar opções, disponibilidade atualizada e condições comerciais claras. A IA usa esse contexto para orientar; ela não deve preencher lacunas com promessas que a operação não consegue cumprir.",
          "Na Zyon, a frente de loja, o catálogo, o agente de IA, o carrinho e o checkout fazem parte da mesma plataforma. A empresa configura produtos, políticas e limites. O cliente pode explicar a necessidade, receber orientação e avançar para a compra com o contexto preservado.",
        ],
        steps: [
          "<strong>Estruture o catálogo:</strong> organize produtos, variantes, preço, disponibilidade e materiais que respondam às dúvidas recorrentes.",
          "<strong>Defina as regras:</strong> configure o que pode ser ofertado, quais descontos são permitidos e quais condições precisam de validação.",
          "<strong>Prepare o atendimento:</strong> defina o tom da marca e as informações que o agente pode usar para recomendar e explicar.",
          "<strong>Revise a jornada:</strong> teste uma conversa real até o checkout e ajuste onde o cliente ainda precisa de ajuda para escolher.",
        ],
      },
      {
        id: "escolher",
        title: "Como escolher a melhor plataforma de e-commerce para pequenas empresas",
        body: [
          "A melhor plataforma de e-commerce é aquela que ajuda a empresa a operar melhor no estágio em que ela está. Para pequenas empresas, vale priorizar uma estrutura que não transforme catálogo, atendimento, pedido e pagamento em ferramentas isoladas.",
          "Antes de comparar planos, avalie se a plataforma permite apresentar a marca, manter o catálogo atual, orientar a escolha do cliente, acompanhar pedidos e configurar regras comerciais. A qualidade da resposta da IA depende da qualidade do contexto que a loja consegue manter.",
        ],
        steps: [
          "<strong>Jornada contínua:</strong> a conversa consegue levar o cliente da dúvida ao carrinho e ao checkout?",
          "<strong>Informação de produto:</strong> o catálogo oferece base suficiente para explicar, comparar e recomendar?",
          "<strong>Controle comercial:</strong> preço, desconto, frete e margem continuam sujeitos às regras da empresa?",
          "<strong>Gestão acessível:</strong> a equipe consegue acompanhar pedidos, atendimento e ajustes sem depender de trabalho técnico para cada mudança?",
        ],
      },
      {
        id: "operacao",
        title: "A IA ajuda a vender. A empresa define a operação.",
        body: [
          "Um vendedor virtual com IA pode tornar uma resposta mais rápida e personalizada. Ainda assim, a empresa precisa decidir o que ele pode consultar, como apresenta condições e quando uma oferta precisa ser recusada. Esse limite protege margem, disponibilidade e confiança.",
          "A Zyon foi desenhada para manter esse controle: o agente usa o conhecimento da loja para orientar, enquanto regras comerciais validam o que pode avançar. O resultado é uma experiência mais assistida para quem compra e mais governável para quem vende.",
        ],
      },
      {
        id: "perguntas",
        title: "Perguntas frequentes sobre plataforma de e-commerce com IA",
        faq: [
          { question: "A Zyon ajuda a criar loja virtual profissional?", answer: "Sim. A plataforma reúne frente de loja, catálogo, atendimento com IA, carrinho e checkout. A empresa configura a marca, os produtos, as condições e os limites da operação." },
          { question: "A IA pode oferecer descontos livremente?", answer: "Não. A IA pode orientar e propor uma próxima ação, mas preço, desconto, frete e margem precisam respeitar as regras comerciais configuradas pela loja." },
          { question: "Posso testar antes de escolher um plano pago?", answer: "Novas lojas podem conhecer a Zyon durante 14 dias. Depois do período de teste, Growth ou Scale mantêm a loja publicada, conforme os recursos e a capacidade necessários para a operação." },
        ],
      },
    ],
    aside: [
      ["Para quem é", "Empresas que querem criar uma loja virtual profissional e usar IA para atender, recomendar e conduzir a compra com critérios claros."],
      ["Ideia-chave", "IA só melhora a venda quando a loja conecta contexto de produto, regras de negócio e próximo passo de compra."],
    ],
    related: [
      ["/agente-ia-para-ecommerce", "Atendimento com IA", "Agente de IA para e-commerce", "Como a IA pode orientar uma escolha sem se desligar do catálogo e das regras da loja."],
      ["/migrar-loja-virtual", "Decisão de plataforma", "Migrar loja virtual", "Um guia para avaliar dados, SEO, checkout e escopo antes de trocar de plataforma."],
      ["/", "Produto", "Veja a Zyon em ação", "Experimente uma conversa conectada a uma loja real e conheça a jornada completa."],
    ],
  },
  {
    slug: "migrar-loja-virtual",
    title: "Migrar loja virtual: guia para mudança de plataforma de e-commerce | Zyon",
    description: "Planeje a migração de plataforma de e-commerce com mais clareza: catálogo, SEO, domínio, checkout, integrações e critérios para avaliar a nova operação.",
    headline: "Migrar loja virtual com um plano que protege catálogo, SEO e checkout.",
    lede: "Trocar de plataforma é uma decisão de operação, não só de layout. Antes de migrar uma loja virtual, vale mapear o que precisa continuar funcionando — e o que a nova jornada precisa melhorar para o cliente e para a equipe.",
    figure: "assets/dashboard-catalog.webp",
    alt: "Painel de catálogo que representa a preparação de produtos em uma migração de plataforma de e-commerce",
    type: "Guia de migração",
    minutes: "10 min de leitura",
    toc: [
      ["quando", "Quando faz sentido migrar loja virtual"],
      ["mapa", "O que mapear antes da migração"],
      ["seo", "SEO e mudança de URLs"],
      ["zyon", "Como avaliar uma migração para a Zyon"],
      ["perguntas", "Perguntas frequentes"],
    ],
    sections: [
      {
        id: "quando",
        title: "Quando faz sentido migrar loja virtual",
        body: [
          "Uma migração de plataforma de e-commerce costuma fazer sentido quando a estrutura atual limita a operação: o catálogo é difícil de manter, o atendimento não acompanha a jornada, integrações exigem trabalho repetido ou o checkout cria atrito que a equipe não consegue resolver.",
          "A decisão fica mais segura quando parte de problemas observáveis. Liste onde o cliente abandona a jornada, quais informações a equipe precisa repetir e quais dados ou regras ficaram fora da plataforma atual. Isso evita trocar de tecnologia sem corrigir o desenho da operação.",
        ],
        note: "Nenhuma migração é automaticamente simples. Prazo, escopo e método dependem do catálogo, das integrações, do domínio e do que precisa ser preservado na operação atual.",
      },
      {
        id: "mapa",
        title: "O que mapear antes de uma migração de plataforma de e-commerce",
        body: [
          "Antes de definir uma nova plataforma, crie um inventário do que existe hoje e indique a fonte de cada dado. Produtos e imagens são apenas uma parte. Variantes, estoque, preço, clientes, pedidos, domínio, eventos de conversão, meios de pagamento, frete e integrações podem ter origens e critérios diferentes.",
          "A equipe também deve registrar as regras que não aparecem em uma exportação: descontos permitidos, limites de margem, exceções de frete, políticas de troca e a forma como o atendimento explica uma condição. Esse material orienta tanto a configuração da nova loja quanto a validação antes do go-live.",
        ],
        steps: [
          "<strong>Dados de catálogo:</strong> produtos, variantes, imagens, preço, disponibilidade e informações que orientam a compra.",
          "<strong>Jornada e integrações:</strong> domínio, URLs relevantes, analytics, pagamento, frete, ERP, CRM e canais que precisam continuar conectados.",
          "<strong>Critérios comerciais:</strong> cupons, promoções, margem mínima, regiões atendidas e qualquer condição que dependa de aprovação.",
          "<strong>Plano de validação:</strong> uma lista de cenários reais para testar catálogo, atendimento, carrinho, checkout e comunicações antes de publicar.",
        ],
      },
      {
        id: "seo",
        title: "SEO na migração: preserve intenção, URLs e sinais de descoberta",
        body: [
          "Uma mudança de plataforma pode afetar a descoberta orgânica quando URLs importantes, títulos, descrições, conteúdo de categoria ou links internos mudam sem planejamento. Não existe garantia de posição no Google, mas há práticas que reduzem perda desnecessária de contexto para buscadores e clientes.",
          "Mapeie as páginas que recebem tráfego, mantenha ou redirecione URLs antigas de forma permanente quando houver equivalentes, preserve títulos e conteúdo que ainda fazem sentido e valide o sitemap, as páginas canônicas e os links internos antes do lançamento. Depois, acompanhe as propriedades no Search Console para encontrar páginas que precisam de ajuste.",
        ],
        steps: [
          "<strong>Antes:</strong> exporte as principais URLs, títulos, descrições, páginas de produto e páginas que recebem tráfego orgânico.",
          "<strong>Durante:</strong> defina redirecionamentos permanentes de cada URL antiga para a página mais equivalente na nova loja.",
          "<strong>Depois:</strong> envie o novo sitemap, valide páginas representativas e acompanhe erros de rastreamento, cobertura e desempenho de busca.",
        ],
      },
      {
        id: "zyon",
        title: "Como avaliar uma migração para a Zyon",
        body: [
          "A Zyon reúne frente de loja, catálogo, agente de IA, carrinho e checkout. Antes de contratar uma migração, a etapa correta é avaliar o escopo da operação: tamanho e qualidade do catálogo, quais integrações são necessárias, como os dados podem ser preparados e quais regras comerciais precisam ser configuradas.",
          "Quem procura a melhor plataforma de e-commerce ou uma plataforma de e-commerce para pequenas empresas precisa comparar a aderência à operação, e não apenas uma lista de recursos. A nova estrutura deve simplificar o trabalho da equipe e melhorar a jornada de compra sem criar dependências que a empresa não consegue sustentar.",
          "Growth e Scale incluem recursos de importação de planilhas com IA. A implantação assistida é opcional e tem escopo confirmado antes da contratação. Ela não substitui a análise de integrações, domínio, SEO ou dados específicos que uma operação existente possa exigir.",
        ],
      },
      {
        id: "perguntas",
        title: "Perguntas frequentes sobre migrar loja virtual",
        faq: [
          { question: "Vou manter meu SEO ao migrar de plataforma?", answer: "O posicionamento não pode ser garantido. Um plano de URLs, redirecionamentos permanentes, conteúdo equivalente, sitemap e acompanhamento no Search Console ajuda a reduzir riscos e permite corrigir problemas mais cedo." },
          { question: "A Zyon faz qualquer migração automaticamente?", answer: "Não. O caminho depende da origem dos dados, do catálogo, das integrações e do escopo. A Zyon permite avaliar a operação e confirmar o trabalho necessário antes de prometer prazo ou método." },
          { question: "O que preciso testar antes de publicar a nova loja?", answer: "Produtos e variantes, disponibilidade, preço, frete, cupons, atendimento, carrinho, checkout, notificações, domínio e as páginas que concentram tráfego orgânico devem fazer parte da validação." },
        ],
      },
    ],
    aside: [
      ["Para quem é", "Equipes que já vendem online e querem avaliar uma mudança de plataforma sem tratar catálogo, SEO e checkout como detalhes posteriores."],
      ["Ideia-chave", "Uma migração bem planejada preserva o que funciona e cria espaço para corrigir os atritos que a operação já conhece."],
    ],
    related: [
      ["/plataforma-ecommerce-com-ia", "Decisão de plataforma", "Plataforma de e-commerce com IA", "Os critérios para escolher uma loja que reúne catálogo, atendimento, carrinho e checkout."],
      ["/agente-ia-para-ecommerce", "Atendimento", "Agente de IA para e-commerce", "Como preparar informação de produto e regras comerciais para uma jornada mais assistida."],
      ["/", "Produto", "Converse sobre sua operação", "Veja a Zyon em ação e leve os dados da sua operação para uma avaliação de escopo."],
    ],
  },
  {
    slug: "agente-ia-para-ecommerce",
    title: "Agente de IA para e-commerce: atendimento que ajuda a vender | Zyon",
    description: "Veja como um agente de IA para e-commerce pode orientar clientes, recomendar produtos e apoiar vendas sem ultrapassar as regras comerciais da sua loja.",
    headline: "Agente de IA para e-commerce: orientar a escolha também é vender.",
    lede: "Um vendedor virtual com IA pode reduzir o caminho entre uma dúvida e uma compra. Para ser útil, ele precisa conhecer os produtos, entender o contexto e respeitar os limites comerciais definidos pela empresa.",
    figure: "assets/dashboard-agent-config.webp",
    alt: "Painel de configuração de um agente de IA para e-commerce, com identidade e regras comerciais da loja",
    type: "Guia de atendimento",
    minutes: "8 min de leitura",
    toc: [
      ["papel", "O papel de um agente de IA"],
      ["contexto", "O que a IA precisa saber"],
      ["vender", "IA para vender na loja virtual"],
      ["controle", "Atendimento com IA e controle comercial"],
      ["perguntas", "Perguntas frequentes"],
    ],
    sections: [
      {
        id: "papel",
        title: "O que um agente de IA para e-commerce faz na jornada de compra",
        body: [
          "Um agente de IA para e-commerce usa as informações da loja para ajudar uma pessoa a descrever o que procura, comparar opções, entender uma condição e seguir para o próximo passo. Ele não precisa substituir a equipe; pode assumir perguntas recorrentes e entregar mais contexto quando o atendimento humano for necessário.",
          "A diferença em relação a um chat genérico está na ligação com a operação. O agente precisa se apoiar em catálogo, disponibilidade e políticas reais, para que uma recomendação não seja apenas persuasiva: ela precisa ser possível de cumprir.",
        ],
        note: "Um vendedor virtual com IA é útil quando torna a decisão mais clara para o cliente e mais verificável para a empresa.",
      },
      {
        id: "contexto",
        title: "O que a IA precisa saber para orientar uma escolha",
        body: [
          "Atendimento com IA para e-commerce depende de contexto. Produtos, variantes, preço, disponibilidade, características, políticas e materiais da marca dão ao agente uma base para responder. A conversa acrescenta a necessidade, a ocasião, a preferência e as dúvidas que surgem durante a jornada.",
          "Quanto melhor estiver organizada a informação da loja, menos o agente precisará pedir para o cliente repetir e mais consistente será a orientação. A preparação não é só técnica: inclui revisar o tom de voz e decidir quais respostas precisam de uma pessoa ou de uma regra antes de avançar.",
        ],
        steps: [
          "<strong>Catálogo confiável:</strong> informações de produto, preço, variantes e disponibilidade atualizadas.",
          "<strong>Conhecimento de compra:</strong> materiais, características, políticas e respostas que ajudam o cliente a comparar alternativas.",
          "<strong>Identidade da marca:</strong> nome, tom e limites de linguagem para que o atendimento tenha coerência com a loja.",
          "<strong>Regras comerciais:</strong> critérios que autorizam preço, desconto, frete e qualquer condição que afete a venda.",
        ],
      },
      {
        id: "vender",
        title: "IA para vender na loja virtual começa por compreender antes de oferecer",
        body: [
          "A IA pode vender na loja virtual ao transformar uma pergunta vaga em um caminho de escolha. Alguém que pergunta por um produto para cabelo, por exemplo, talvez precise explicar o tipo de fio, o resultado desejado, a frequência de uso ou a preferência de textura antes de receber uma recomendação.",
          "Esse processo não precisa parecer um formulário. O agente pode conduzir uma conversa curta, explicar por que uma opção faz sentido e apresentar alternativas quando houver mais de um caminho possível. A venda avança porque a pessoa entende a escolha — não porque foi pressionada a clicar.",
        ],
      },
      {
        id: "controle",
        title: "Atendimento com IA para e-commerce precisa respeitar a regra da loja",
        body: [
          "Uma conversa pode sugerir uma condição, mas não deve autorizar sozinha uma mudança de preço, desconto, frete ou margem. Quando uma oferta afeta a operação, a fonte de verdade deve ser uma política configurada pela empresa. A IA apresenta a resposta de forma clara; a regra confirma se ela pode ser aplicada.",
          "Na Zyon, o agente de IA usa o catálogo e o contexto da conversa para orientar. A empresa define as regras comerciais e acompanha a operação pelo painel. Assim, a automação pode reduzir atrito na venda sem criar uma promessa fora dos limites do negócio.",
        ],
      },
      {
        id: "perguntas",
        title: "Perguntas frequentes sobre atendimento com IA para e-commerce",
        faq: [
          { question: "Um agente de IA substitui toda a equipe de vendas?", answer: "Não necessariamente. Ele pode apoiar as perguntas repetitivas, orientar escolhas e preservar o contexto. Casos que pedem julgamento humano, exceção ou acompanhamento específico continuam podendo ser assumidos pela equipe." },
          { question: "O agente pode recomendar produtos?", answer: "Sim. A recomendação usa as informações disponíveis no catálogo e o contexto compartilhado pelo cliente. A loja deve manter produtos, disponibilidade e materiais organizados para sustentar essa orientação." },
          { question: "Como a Zyon protege a margem em uma conversa?", answer: "A IA pode explicar e propor o próximo passo, mas condições comerciais precisam respeitar as regras configuradas pela operação. Isso separa uma conversa útil de uma promessa que não pode ser cumprida." },
        ],
      },
    ],
    aside: [
      ["Para quem é", "Lojas que recebem dúvidas recorrentes e querem transformar atendimento em orientação de compra, com a empresa no comando das condições."],
      ["Ideia-chave", "A IA interpreta a necessidade. A loja fornece o contexto e autoriza a condição comercial."],
    ],
    related: [
      ["/plataforma-ecommerce-com-ia", "Plataforma", "Plataforma de e-commerce com IA", "Como reunir loja, catálogo, atendimento, carrinho e checkout em uma mesma jornada."],
      ["/governanca-de-ia-no-ecommerce", "Regras comerciais", "Governança de IA no e-commerce", "Por que uma sugestão precisa ser diferente de uma autorização de venda."],
      ["/", "Produto", "Experimente a loja ao vivo", "Faça uma pergunta em uma loja real e acompanhe a IA orientar o próximo passo."],
    ],
  },
  {
    slug: "como-vender-pelo-whatsapp-com-ia",
    published: "2026-10-16",
    publishedLabel: "16 out. 2026",
    title: "Como vender pelo WhatsApp com IA sem perder o controle | Zyon",
    description: "Entenda como estruturar vendas pelo WhatsApp com IA, catálogo, regras comerciais, checkout e atendimento humano quando necessário.",
    headline: "Como vender pelo WhatsApp com IA sem entregar o controle da sua operação.",
    lede: "Vender pelo WhatsApp não é apenas responder rápido. Para uma conversa virar pedido com confiança, a resposta precisa usar informações reais de produto e respeitar as condições que a empresa decidiu praticar.",
    figure: "assets/dashboard-agent-config.webp",
    alt: "Painel de configuração de um agente de IA que representa o preparo de uma operação de vendas",
    type: "Guia de vendas",
    minutes: "9 min de leitura",
    toc: [["por-que", "Por que o WhatsApp vira canal de vendas"], ["estrutura", "O que precisa estar conectado"], ["fluxo", "O fluxo da conversa ao pedido"], ["limites", "O que a IA não decide sozinha"], ["perguntas", "Perguntas frequentes"]],
    sections: [
      { id: "por-que", title: "Por que o WhatsApp vira um canal de vendas — e não só de atendimento", body: ["Em muitas lojas, a conversa começa no WhatsApp porque o cliente quer confirmar uma medida, comparar uma opção, entender o frete ou tirar uma última dúvida antes de pagar. Quando a resposta demora ou não encontra a informação certa, a intenção de compra esfria mesmo que o produto seja adequado.", "A IA pode ajudar a manter a conversa em movimento: entende a necessidade, encontra produtos relevantes e organiza o próximo passo. Mas velocidade não basta. A indicação precisa partir do catálogo e a condição comercial precisa ser verificável pela operação."], note: "O objetivo não é automatizar qualquer resposta. É dar continuidade à jornada sem criar uma promessa que preço, estoque, frete ou política da loja não conseguem cumprir." },
      { id: "estrutura", title: "O que precisa estar conectado antes de automatizar vendas", body: ["Um atendimento comercial consistente precisa de uma fonte confiável para produtos, variantes, preço, disponibilidade, prazo, políticas e formas de pagamento. Sem isso, um agente pode até parecer convincente, mas não consegue sustentar o que ofereceu quando o cliente tenta avançar.", "Também é importante definir quando uma dúvida deve sair do fluxo automatizado. Troca fora da política, negociação excepcional, produto sem informação suficiente e pedido sensível são exemplos de situações em que a equipe deve receber contexto e assumir a conversa."], steps: ["<strong>Organize o catálogo:</strong> mantenha produto, variante, preço, disponibilidade e informações de decisão atualizados.", "<strong>Defina as condições:</strong> estabeleça regras para desconto, frete, promoções e qualquer exceção comercial.", "<strong>Conecte o próximo passo:</strong> garanta que carrinho, checkout ou link de pagamento recebam o contexto da conversa.", "<strong>Planeje a transferência:</strong> explique quem atende casos complexos e quais dados essa pessoa receberá."] },
      { id: "fluxo", title: "Um fluxo de venda pelo WhatsApp que preserva contexto", body: ["Uma boa jornada começa com a intenção do cliente, não com um menu infinito. A pessoa pode dizer o que procura, para qual ocasião, faixa de preço ou preferência. A conversa transforma isso em critérios claros e apresenta opções que ela consegue comparar.", "Depois da escolha, o ideal é confirmar variante, quantidade, endereço quando necessário e condição de entrega antes de encaminhar para o pagamento. O pedido não deveria depender de a pessoa repetir no checkout tudo o que já informou no chat. Ainda assim, confirmação de preço, frete e pagamento precisa ocorrer nas etapas próprias da operação."] },
      { id: "limites", title: "O que a IA não deve decidir sozinha", body: ["Uma IA pode explicar, sugerir e conduzir uma conversa. Isso é diferente de autorizar uma condição comercial. Desconto, margem, subsídio de frete, disponibilidade e confirmação de pagamento devem continuar sujeitos às regras e às fontes de verdade da empresa.", "Esse é o princípio usado pela Zyon: a IA propõe a próxima ação, enquanto a política comercial autoriza o que pode ser oferecido. Ao avaliar uma solução para WhatsApp, procure saber de onde vêm as respostas, quais ações exigem validação e como a equipe corrige uma informação desatualizada."] },
      { id: "perguntas", title: "Perguntas frequentes sobre vender pelo WhatsApp com IA", faq: [{ question: "A IA consegue vender sem atendimento humano?", answer: "Ela pode apoiar etapas repetitivas, orientar a escolha e conduzir o próximo passo. Casos fora da política, exceções comerciais ou dúvidas sem base confiável devem ter transferência clara para uma pessoa." }, { question: "Como evitar que a IA informe preço ou estoque errado?", answer: "Use catálogo e regras atualizados como fonte de resposta, valide condições no fluxo de compra e bloqueie a criação de condições fora das políticas da empresa." }, { question: "Posso enviar campanhas de venda para qualquer contato no WhatsApp?", answer: "Não. Mensagens iniciadas pela empresa dependem das regras do canal, do tipo de mensagem aplicável e do consentimento do destinatário. A operação deve validar esses requisitos antes de disparar campanhas." }] },
    ],
    aside: [["Para quem é", "Lojas que já recebem intenção de compra no WhatsApp e querem transformar conversa em uma jornada verificável, não em uma sequência de respostas soltas."], ["Ideia-chave", "A IA mantém a conversa útil; catálogo, regras e checkout mantêm a venda possível de cumprir."]],
    related: [["/chatbot-whatsapp-loja-virtual", "Decisão de ferramenta", "Chatbot para loja virtual", "O que avaliar antes de colocar um bot para atender clientes e vender pelo WhatsApp."], ["/integrar-whatsapp-loja-virtual", "Operação", "Integrar WhatsApp à loja virtual", "Como conectar conversa, catálogo, estoque e checkout sem transformar canais em silos."], ["/agente-ia-para-ecommerce", "Atendimento", "Agente de IA para e-commerce", "Como preparar contexto e regras para uma recomendação comercial mais confiável."]],
  },
  {
    slug: "chatbot-whatsapp-loja-virtual",
    published: "2026-10-16",
    publishedLabel: "16 out. 2026",
    title: "Chatbot para WhatsApp de loja virtual: o que avaliar | Zyon",
    description: "Veja o que avaliar em um chatbot para WhatsApp de loja virtual: catálogo, atendimento humano, integrações, regras comerciais, custos e experiência de compra.",
    headline: "Chatbot para WhatsApp de loja virtual: o que precisa funcionar além da resposta automática.",
    lede: "Um chatbot pode reduzir perguntas repetitivas. Um canal de vendas confiável, porém, precisa saber quando orientar, quando confirmar uma condição e quando chamar uma pessoa.",
    figure: "assets/dashboard-overview.webp",
    alt: "Painel de operação de comércio que representa acompanhamento de pedidos e atendimento",
    type: "Guia de avaliação",
    minutes: "8 min de leitura",
    toc: [["diferenca", "Chatbot, agente de IA e canal de vendas"], ["avaliar", "O que avaliar antes de contratar"], ["humano", "Quando o atendimento humano entra"], ["custo", "Como analisar custo"], ["perguntas", "Perguntas frequentes"]],
    sections: [
      { id: "diferenca", title: "Chatbot, agente de IA e canal de vendas não são a mesma coisa", body: ["Um chatbot tradicional segue opções e respostas predefinidas. Um agente de IA pode interpretar perguntas abertas, recuperar contexto e sugerir uma próxima ação. Nenhum dos dois, por si só, garante uma venda bem concluída.", "Para operar vendas, a conversa precisa estar ligada a informação de produto, regras da empresa e um caminho de compra. Sem essa conexão, o bot pode responder bem e ainda assim deixar o cliente sem certeza sobre o que está disponível, quanto custa ou como finalizar."] },
      { id: "avaliar", title: "O que avaliar em um chatbot para loja virtual", body: ["Compare soluções pela jornada inteira, não apenas por uma demonstração de conversa. Peça para ver como a ferramenta encontra um produto, lida com variantes, responde quando não sabe, transfere o histórico para uma pessoa e registra o que aconteceu depois do pagamento.", "A mesma pergunta vale para cada integração: a informação chega em tempo útil? A equipe consegue corrigir dados? Existe um registro para revisar respostas e conversas? Uma ferramenta simples pode servir para dúvidas iniciais; uma operação com catálogo e pedidos exige critérios adicionais."], steps: ["<strong>Base de resposta:</strong> confirme se produtos, políticas e informações vêm de fontes identificáveis e atualizáveis.", "<strong>Jornada de compra:</strong> veja se a conversa preserva itens, variante e contexto até o carrinho ou checkout.", "<strong>Controle comercial:</strong> valide quem autoriza descontos, frete promocional e exceções.", "<strong>Operação humana:</strong> teste transferência, fila, contexto entregue e retorno ao cliente.", "<strong>Canal oficial:</strong> confirme requisitos do provedor, templates, consentimentos e configuração da conta comercial."] },
      { id: "humano", title: "Quando o atendimento humano precisa entrar", body: ["O melhor atendimento automatizado não tenta vencer toda conversa. Ele reduz trabalho repetitivo e deixa a equipe disponível para as situações em que julgamento, contexto adicional ou negociação responsável fazem diferença.", "Defina gatilhos de transferência antes do lançamento: reclamações, pedidos com exceções, dúvidas sobre troca, negociação fora da política, intenção de compra de alto valor ou qualquer resposta em que a base não seja suficiente. O cliente deve entender que existe uma transição — e não sentir que foi abandonado pelo bot."] },
      { id: "custo", title: "Como analisar custo sem olhar só a mensalidade", body: ["O custo de um chatbot pode incluir plataforma, implantação, integrações, volume de conversas, uso de IA e mensagens cobradas pelo canal. Por isso, uma comparação justa começa pela operação: quantas conversas chegam, quantas precisam de dados externos, quem atualiza a base e o que acontece quando o volume cresce.", "Pergunte também o que está incluído depois da ativação. Atualizar catálogo, adicionar um novo fluxo, acompanhar conversas e manter integrações pode exigir esforço contínuo. A solução adequada é a que torna esse trabalho previsível e proporcional ao que ela resolve."] },
      { id: "perguntas", title: "Perguntas frequentes sobre chatbot para WhatsApp de loja virtual", faq: [{ question: "Qual é a diferença entre chatbot e atendimento com IA?", answer: "Um chatbot costuma seguir fluxos definidos. Um agente de IA consegue interpretar linguagem mais aberta, mas ainda precisa de fontes confiáveis, limites de ação e revisão operacional para ser usado em vendas." }, { question: "Um chatbot pode consultar catálogo e pedido?", answer: "Pode, quando existe integração e autorização adequadas. Antes de contratar, confirme quais dados são consultados, com que frequência são atualizados e o que acontece se a informação estiver indisponível." }, { question: "Como escolher entre chatbot barato e uma solução integrada?", answer: "Comece pela dor que precisa resolver. Se a prioridade é triagem simples, um fluxo básico pode bastar. Se a conversa precisa orientar compra, confirmar condição e avançar para pedido, avalie a jornada integrada e o custo total de operação." }] },
    ],
    aside: [["Para quem é", "Gestores de lojas que recebem muitas mensagens e querem comparar soluções sem confundir uma resposta automática com uma operação comercial pronta."], ["Ideia-chave", "A qualidade de um chatbot aparece quando ele não sabe, quando o preço muda e quando a conversa precisa chegar a uma pessoa."]],
    related: [["/como-vender-pelo-whatsapp-com-ia", "Guia de vendas", "Vender pelo WhatsApp com IA", "Como estruturar uma conversa comercial com regras, contexto e próximo passo."], ["/integrar-whatsapp-loja-virtual", "Operação", "Integrar WhatsApp à loja virtual", "O mapa técnico e operacional para não separar chat, catálogo e checkout."], ["/governanca-de-ia-no-ecommerce", "Controle comercial", "Governança de IA no e-commerce", "Como separar sugestão de IA de autorização de preço, margem e frete."]],
  },
  {
    slug: "integrar-whatsapp-loja-virtual",
    published: "2026-10-16",
    publishedLabel: "16 out. 2026",
    title: "Como integrar WhatsApp à loja virtual: catálogo, estoque e checkout | Zyon",
    description: "Um guia para integrar WhatsApp à loja virtual sem separar conversa, catálogo, estoque, pedidos, checkout e atendimento humano.",
    headline: "Como integrar WhatsApp à loja virtual sem criar mais um canal isolado.",
    lede: "A integração certa não é apenas colocar um botão de WhatsApp no site. É fazer com que a conversa tenha contexto e que a operação consiga confirmar o que foi combinado até o pedido.",
    figure: "assets/dashboard-catalog.webp",
    alt: "Painel de catálogo que representa a organização de produtos e variantes para uma loja virtual",
    type: "Guia de operação",
    minutes: "10 min de leitura",
    toc: [["objetivo", "O que integrar de verdade"], ["dados", "Dados que não podem se perder"], ["passos", "Como preparar a integração"], ["validacao", "O que validar antes de ativar"], ["perguntas", "Perguntas frequentes"]],
    sections: [
      { id: "objetivo", title: "O que significa integrar WhatsApp à loja virtual", body: ["Adicionar um link que abre uma conversa é útil, mas não resolve sozinho a venda. Uma integração comercial conecta o que a pessoa perguntou, os produtos que viu, as opções escolhidas e o pedido que será criado. Assim, a equipe não precisa reconstruir o contexto em cada ferramenta.", "O desenho ideal varia conforme a operação. Algumas lojas precisam somente orientar e levar para o checkout; outras precisam consultar disponibilidade, calcular entrega, acompanhar pedido ou encaminhar atendimento. O ponto de partida é definir quais decisões a conversa pode apoiar e quais sistemas são a fonte de cada informação."] },
      { id: "dados", title: "Dados que não podem se perder entre conversa e compra", body: ["Catálogo, variante, quantidade, preço, disponibilidade, endereço, frete, cupom, identificação do cliente e status do pedido são dados com papéis diferentes. Misturá-los em mensagens livres cria risco de inconsistência. Eles precisam ter fonte, formato e momento de confirmação definidos.", "Também separe informação de recomendação e condição final. A conversa pode apresentar uma alternativa; o carrinho e o checkout devem confirmar o que de fato será comprado. Isso reduz erros de interpretação e deixa claro para cliente e equipe quando uma condição está confirmada."], note: "A integração mais segura não pressupõe que toda mensagem é verdadeira por estar no chat. Ela verifica dados essenciais nas etapas que autorizam a venda." },
      { id: "passos", title: "Como preparar uma integração entre WhatsApp e loja virtual", body: ["Comece pelo mapa atual: onde os produtos vivem, como o estoque é atualizado, como o frete é calculado, onde o pagamento é confirmado e quem atende exceções. Só então escolha quais integrações precisam ser em tempo real e quais podem ser revisadas pela equipe.", "A implantação deve incluir um cenário de atualização. Se preço, estoque, política ou catálogo mudarem, alguém precisa saber onde fazer a alteração e quando o canal de conversa passará a usar o dado novo."], steps: ["<strong>Mapeie sistemas e responsáveis:</strong> catálogo, estoque, ERP, frete, pagamento, CRM e atendimento.", "<strong>Defina fontes de verdade:</strong> indique qual sistema confirma cada dado e o que fazer quando ele não responder.", "<strong>Desenhe o caminho de compra:</strong> estabeleça quando o chat recomenda, quando o carrinho confirma e quando o checkout cria o pedido.", "<strong>Configure segurança e consentimento:</strong> use o canal autorizado, limite acessos e trate mensagens de campanha conforme as permissões aplicáveis.", "<strong>Crie uma rotina de revisão:</strong> acompanhe conversas sem resposta, transferências, erros de informação e pontos de abandono."] },
      { id: "validacao", title: "O que validar antes de ativar a integração", body: ["Teste situações reais, não apenas a mensagem de boas-vindas. Procure um produto por uma característica, escolha uma variante, altere quantidade, simule indisponibilidade, calcule entrega, avance ao checkout e confirme se o pedido registra o que foi combinado. Teste também o caminho em que a informação está ausente e a conversa precisa pedir ajuda humana.", "Para comunicações iniciadas pela empresa, verifique requisitos do provedor, a classificação da mensagem, o consentimento e o comportamento quando o envio não estiver elegível. Uma interface publicada ou uma API saudável não prova, por si só, que uma mensagem foi autorizada e entregue a um cliente real."] },
      { id: "perguntas", title: "Perguntas frequentes sobre integrar WhatsApp à loja virtual", faq: [{ question: "Preciso trocar de plataforma para integrar WhatsApp à loja?", answer: "Não necessariamente. O primeiro passo é mapear as integrações existentes e identificar se a plataforma atual oferece os dados e os pontos de conexão necessários. A decisão depende do objetivo e da operação." }, { question: "A integração atualiza estoque em tempo real?", answer: "Isso depende da arquitetura, do sistema de estoque e da integração contratada. Uma operação deve confirmar a origem, a frequência de atualização e o comportamento quando a informação não está disponível." }, { question: "Como sei se a integração está pronta para vender?", answer: "Valide a jornada completa com cenários representativos: catálogo, variante, preço, disponibilidade, frete, checkout, pagamento, criação de pedido, transferência humana e comunicação pós-venda." }] },
    ],
    aside: [["Para quem é", "Operações que querem usar WhatsApp como parte da jornada de compra e precisam evitar duplicidade de informação, pedido manual e promessas desencontradas."], ["Ideia-chave", "Conversa integrada é aquela que carrega contexto até a compra — sem substituir as validações que protegem o cliente e a empresa."]],
    related: [["/como-vender-pelo-whatsapp-com-ia", "Guia de vendas", "Vender pelo WhatsApp com IA", "Como usar a conversa para orientar a compra, com limites claros para condições comerciais."], ["/chatbot-whatsapp-loja-virtual", "Decisão de ferramenta", "Chatbot para loja virtual", "Critérios para escolher uma solução além de respostas automáticas."], ["/migrar-loja-virtual", "Decisão de plataforma", "Migrar loja virtual", "O que mapear quando uma mudança de plataforma faz parte da integração desejada."]],
  },
];

function articleMarkup(article) {
  const url = `${siteUrl}/${article.slug}`;
  const articlePublished = article.published ?? published;
  const articlePublishedLabel = article.publishedLabel ?? "7 out. 2026";
  const breadcrumb = [
    { "@type": "ListItem", position: 1, name: "Início", item: `${siteUrl}/` },
    { "@type": "ListItem", position: 2, name: "Biblioteca", item: `${siteUrl}/recursos` },
    { "@type": "ListItem", position: 3, name: article.headline, item: url },
  ];
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: breadcrumb },
      { "@type": "Article", "@id": `${url}#article`, headline: article.title.replace(" | Zyon", ""), description: article.description, mainEntityOfPage: url, image: `${siteUrl}/${article.figure}`, datePublished: articlePublished, dateModified: articlePublished, inLanguage: "pt-BR", articleSection: "E-commerce com IA", author: { "@type": "Organization", name: "Zyon", url: `${siteUrl}/` }, publisher: { "@type": "Organization", name: "Zyon", url: `${siteUrl}/`, logo: { "@type": "ImageObject", url: `${siteUrl}/assets/zyon-logo-new.png` } } },
    ],
  };
  const content = article.sections.map((section) => {
    const prose = section.body ? paragraphs(section.body) : "";
    const stepList = section.steps ? list(section.steps) : "";
    const note = section.note ? `<div class="authority-note">${section.note}</div>` : "";
    const faq = section.faq ? questions(section.faq) : "";
    return `<h2 id="${section.id}">${section.title}</h2>${prose}${note}${stepList}${faq}`;
  }).join("\n");
  const toc = article.toc.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("\n");
  const aside = article.aside.map(([title, text]) => `<div class="authority-aside__block"><h2>${title}</h2><p>${text}</p></div>`).join("\n");
  const related = article.related.map(([href, type, title, text]) => `<article><a href="${href}"><span>${type}</span><h3>${title}</h3><p>${text}</p></a></article>`).join("\n");
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
    <meta name="description" content="${escape(article.description)}" />
    <meta name="theme-color" content="#0b1915" />
    <link rel="canonical" href="${url}" />
    <link rel="icon" type="image/png" href="assets/zyon-mark.png" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="pt_BR" />
    <meta property="og:site_name" content="Zyon" />
    <meta property="og:title" content="${escape(article.title.replace(" | Zyon", ""))}" />
    <meta property="og:description" content="${escape(article.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${siteUrl}/${article.figure}" />
    <meta property="og:image:alt" content="${escape(article.alt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escape(article.title.replace(" | Zyon", ""))}" />
    <meta name="twitter:description" content="${escape(article.description)}" />
    <meta name="twitter:image" content="${siteUrl}/${article.figure}" />
    <title>${escape(article.title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&amp;family=Manrope:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="assets/base.css" />
    <link rel="stylesheet" href="assets/authority.css" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
  </head>
  <body class="authority-page">
    <a class="skip-link" href="#conteudo">Ir para o conteúdo</a>
    <header class="authority-header"><div class="authority-header__inner"><a class="authority-brand" href="/" aria-label="Zyon, página inicial"><img src="assets/zyon-mark.png" alt="" width="28" height="28" /><span>zyon</span></a><nav class="authority-nav" aria-label="Navegação principal"><a href="/">Produto</a><a href="/recursos">Conteúdo</a><a href="/recursos#metodo">Método</a></nav><a class="authority-header__cta" href="https://app.zyon-payments.com.br/?mode=signup&amp;plan=starter">Começar grátis</a></div></header>
    <main id="conteudo">
      <section class="authority-hero" aria-labelledby="article-title">
        <div class="authority-hero__copy"><span class="authority-kicker">${article.type} · Biblioteca Zyon</span><h1 id="article-title">${article.headline}</h1><p class="authority-hero__lede">${article.lede}</p><p class="authority-byline"><strong>Equipe Zyon</strong><span>${articlePublishedLabel}</span><span>${article.minutes}</span></p></div>
        <figure class="authority-figure"><img src="${article.figure}" alt="${escape(article.alt)}" width="1536" height="1024" /></figure>
      </section>
      <section class="authority-article-shell">
        <nav class="authority-toc" aria-label="Neste guia"><p>Neste guia</p>${toc}</nav>
        <article class="authority-prose">${content}<p><a class="authority-related__link" href="https://app.zyon-payments.com.br/?mode=signup" target="_blank" rel="noopener noreferrer">Criar minha loja e testar por 14 dias →</a></p></article>
        <aside class="authority-aside" aria-label="Contexto do guia">${aside}</aside>
      </section>
      <section class="authority-related" aria-labelledby="related-title"><div class="authority-related__top"><div><span class="authority-kicker">Continue a leitura</span><h2 id="related-title">A próxima decisão fica melhor com o contexto certo.</h2></div><a class="authority-related__link" href="/recursos">Ver toda a biblioteca →</a></div><div class="authority-related__grid">${related}</div></section>
    </main>
    <footer class="authority-footer"><div class="authority-footer__inner"><div><a class="authority-brand" href="/" aria-label="Zyon, página inicial"><img src="assets/zyon-mark.png" alt="" width="28" height="28" /><span>zyon</span></a><p>Inteligência de comércio com decisão comercial no comando.</p></div><nav aria-label="Links do rodapé"><a href="/recursos">Biblioteca</a><a href="/privacidade">Privacidade</a><a href="/termos">Termos</a><a href="mailto:contato@zyon-payments.com.br">Contato</a></nav></div></footer>
  </body>
</html>`;
}

await Promise.all(articles.map((article) => writeFile(path.join(webRoot, `${article.slug}.html`), articleMarkup(article), "utf8")));
console.log(`Built ${articles.length} commercial articles for the Zyon library.`);
