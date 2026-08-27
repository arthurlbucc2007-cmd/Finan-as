# Meu Financeiro

App web local para controlar seus gastos mensais — inspirado no seu Atalho de iOS "Registrar Gastos".

## Como usar

Abra `index.html` no navegador (duplo clique funciona). Não precisa de instalação nem servidor.

Por padrão, os dados ficam salvos só no navegador (localStorage), no seu computador. Se limpar os dados do navegador, os lançamentos somem — por isso, exporte um backup de vez em quando em **Configurações → Exportar backup (JSON)**, ou ative a sincronização na nuvem (veja abaixo).

## Sincronizar com Supabase (opcional)

Sem configurar nada, o app funciona 100% local. Para sincronizar seus dados entre celular/computador com login por e-mail, conecte um projeto Supabase:

1. Crie uma conta e um projeto em [supabase.com](https://supabase.com) (grátis).
2. No projeto, abra **SQL Editor** e rode o conteúdo do arquivo [`supabase/schema.sql`](supabase/schema.sql) deste repositório — isso cria as tabelas e as políticas de segurança (cada usuário só vê os próprios dados).
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.
4. Abra o arquivo [`config.js`](config.js) e cole os dois valores em `window.SUPABASE_CONFIG`.
5. Em **Authentication → Providers**, confirme que o login por e-mail (Email OTP / magic link) está habilitado (vem habilitado por padrão).
6. Recarregue o site. Vai aparecer uma tela de login — digite seu e-mail, clique no link que chegar na caixa de entrada, e pronto: seus dados passam a ficar no Supabase, acessíveis de qualquer dispositivo.

A chave "anon" é pública por design (protegida pelas políticas de RLS do schema) — não precisa tratá-la como segredo, mas evite comitar a URL do projeto se preferir manter tudo privado.

> Se você publicar este repositório no GitHub Pages/Vercel/Netlify para acessar o site de qualquer lugar, adicione a URL publicada em **Authentication → URL Configuration → Redirect URLs** no Supabase, senão o link mágico não vai completar o login.

## O que tem

- **Dashboard** — receitas, despesas, saldo do mês, gastos por categoria e por forma de pagamento, comparação com o mês anterior.
- **Transações** — adicionar/editar/excluir lançamentos (igual ao Atalho: valor, categoria, forma de pagamento, descrição, data), com filtros e busca.
- **Orçamentos** — defina um limite mensal por categoria e acompanhe o progresso.
- **Assinaturas** — cadastre gastos recorrentes (Netflix, academia, etc.) e lance com um clique todo mês.
- **Metas** — reserva de emergência, viagem, o que quiser: defina um alvo e vá contribuindo.
- **Calculadora CDI** — quanto seu saldo rende passivamente (por dia/mês/ano) e um simulador de investimento com aportes mensais, taxa de CDI editável e estimativa de IR.
- **Configurações** — editar categorias e formas de pagamento (mesma lógica de listas do Atalho), tema claro/escuro, exportar/importar CSV e backup completo.

## Categorias e formas de pagamento padrão

As mesmas do seu Atalho — edite livremente em Configurações:

- Categorias: Luz, Saídas / Namoro, Investimentos, Roupas / Compras, Presentes, Mercado, Transporte, Assinaturas, Saúde / Cuidados, Outros
- Formas de pagamento: PIX, Crédito, Débito, Vale Alimentação, Dinheiro

## Importar seu Gastos.csv do Atalho

Em **Transações → Importar CSV**, aceita o formato `Data;Valor;Categoria;Forma de Pagamento;Descrição` (com `;` como separador, igual ao que o Atalho gera).
