# Organizador de Campeonato

Monte a tabela do seu campeonato no navegador: pontos corridos, mata-mata ou grupos com mata-mata, com folgas, cabeças de chave, classificação ao vivo e critérios de desempate configuráveis, incluindo o confronto direto entre três ou mais empatados. Serve para o torneio da firma, a liga da quadra do bairro, o campeonato de futsal da escola ou o de videogame com os amigos.

**Acesse online:** https://micdog22.github.io/organizador-de-campeonato/

## Recursos

- **Pontos corridos** em turno único ou turno e returno, com a tabela gerada pelo método do círculo (tabelas de Berger): cada par se enfrenta uma vez por turno, ninguém joga duas vezes na mesma rodada, mandos equilibrados e folga quando o número de times é ímpar.
- **Mata-mata** com chaveamento por cabeças de chave (1 e 2 só se cruzam na final), folgas até a próxima potência de 2 para os melhores colocados, pênaltis no empate e disputa de 3º lugar opcional.
- **Grupos + mata-mata:** distribuição em serpentina pelos potes (ou sorteio), escolha de quantos avançam por grupo, cabeças de chave pela campanha e nenhum confronto entre times do mesmo grupo na primeira fase do mata-mata.
- **Classificação** com pontos, jogos, vitórias, empates, derrotas, gols pró e contra, saldo e aproveitamento, atualizada a cada placar.
- **Critérios de desempate configuráveis:** pontuação (3/1/0 ou outra), vitórias, saldo, gols pró, confronto direto e sorteio, na ordem que você quiser. A tela explica cada desempate ("Time A ficou à frente de Time B por saldo de gols").
- **Correções seguras:** mudou um resultado do mata-mata? Os jogos seguintes que dependiam dele voltam a ficar abertos.
- **Backup em JSON** (exportar e importar, com validação do arquivo), **classificação em CSV** pronta para o Excel em português e **impressão** de tabela, rodadas e chave.
- Tudo salvo no `localStorage` do navegador; nada sai do seu computador.

## Como usar

1. Escreva os times, um por linha (ou clique em "Usar times de exemplo"). Nos formatos com mata-mata, a ordem da lista vale como ranking de cabeças de chave.
2. Escolha o formato e as opções: turnos, número de grupos, classificados, disputa de 3º lugar, sorteio ou ordem da lista.
3. Ajuste a pontuação e a ordem dos critérios de desempate.
4. Clique em "Criar campeonato" e vá preenchendo os placares. Nos grupos, quando todos os jogos tiverem placar, gere o mata-mata na aba "Mata-mata".
5. Use "Exportar backup" para guardar o arquivo ou continuar em outro computador, e "Baixar CSV" para levar a classificação para uma planilha.

## Como rodar localmente

Não há build nem dependências. Sirva a pasta por HTTP:

```bash
python3 -m http.server 8000
```

E abra http://localhost:8000.

## Testes

```bash
npm test
```

(ou `node --test`, com Node 18 ou mais novo). Os testes conferem as propriedades da tabela de pontos corridos para 2 a 24 times (cada par uma vez, ninguém duas vezes na rodada, uma folga por time, mandos equilibrados e o número mínimo de quebras de mando), o turno e returno, a ordem dos cabeças de chave, as folgas, o avanço no chaveamento com pênaltis e correções, cada critério de desempate (inclusive o confronto direto entre três empatados e o recálculo entre os que seguem empatados), a geração do mata-mata a partir de 2 a 8 grupos sem confrontos do mesmo grupo na estreia, o CSV e a validação do backup.

## Como funciona

### A tabela de pontos corridos

Com n times (se n for ímpar, entra um time fantasma, e quem o enfrenta folga), numere os times de 1 a n. Na rodada r, de 1 a n - 1:

- dois times x e y diferentes de n se enfrentam quando `x + y ≡ r + 1 (mod n - 1)`;
- o time n enfrenta o único time a com `2a ≡ r + 1 (mod n - 1)`.

Isso é o método do círculo: o time n fica parado e os outros giram uma posição por rodada. Para o mando, a regra das tabelas de Berger é: entre x e y, manda quem tem `(y - x) mod (n - 1)` ímpar; o time n manda nas rodadas pares. O resultado é a tabela clássica (para 6 times, a primeira rodada é 1x6, 2x5, 3x4) com mandos divididos (cada time tem n/2 ou n/2 - 1 jogos em casa) e só n - 2 "quebras" (dois jogos seguidos em casa ou fora), que é o mínimo possível. No returno, os jogos se repetem com os mandos invertidos.

### O chaveamento

A ordem dos cabeças de chave é construída por dobras: começa em `[1, 2]` e cada semente s ganha como vizinha a semente `2k + 1 - s`, em que k é o tamanho atual da lista. Para 8 vagas: `1 8 4 5 2 7 3 6`. Os jogos da primeira fase são os pares vizinhos, então o 1 só pode encontrar o 2 na final, e os quatro primeiros só se cruzam nas semifinais.

Quando o número de times não é potência de 2, as vagas que sobram viram folgas. Como as sementes mais altas ficam ao lado das mais baixas, as folgas caem sempre contra os melhores cabeças de chave, e nunca há "folga contra folga".

Cada jogo do mata-mata guarda o resultado junto com os dois times que o disputaram. Se um resultado anterior muda, o jogo seguinte passa a ter outro adversário, o resultado antigo deixa de valer e o jogo volta a ficar aberto.

### Grupos e cabeças de chave

Os times são distribuídos em serpentina: 1º no grupo A, 2º no B, 3º no C, e na volta do C para o A. Assim os melhores da lista ficam em grupos diferentes. Ao fim da fase de grupos, os classificados são ordenados primeiro pela posição (todos os líderes, depois os segundos...) e, entre os de mesma posição, pela campanha: aproveitamento, saldo por jogo, gols pró por jogo e sorteio (por média, porque os grupos podem ter tamanhos diferentes). Se a ordem pura colocar dois times do mesmo grupo frente a frente na primeira fase, o programa troca o adversário por outro de mesma posição em um confronto onde a troca não cria outro choque.

### Os critérios de desempate

A classificação começa pelos pontos. Entre os empatados, aplica-se o primeiro critério da lista; se ele separar só parte dos times, cada subgrupo que continua empatado recomeça a lista. Isso importa no confronto direto: ele é calculado como uma minitabela só com os jogos entre os times empatados (pontos, depois saldo e gols pró nesses jogos). Se três times empatam e a minitabela dos três não decide, mas outro critério tira um deles do bolo, o confronto direto é recalculado só entre os dois que sobraram. O sorteio é sempre o último critério: cada time recebe um número aleatório (com `crypto.getRandomValues`) quando o campeonato é criado, então o resultado do sorteio não muda a cada visita.

### CSV para o Excel em português

O Excel configurado em português usa vírgula como separador decimal, então o CSV sai com ponto e vírgula entre as colunas, aproveitamento com vírgula decimal, quebras de linha CRLF e BOM UTF-8 no início (sem ele, os acentos chegam errados). Nomes que começam com `=`, `+`, `-` ou `@` ganham um apóstrofo na frente para não serem interpretados como fórmula.

## Estrutura

```
index.html            página
styles.css            estilos (tema claro e escuro, impressão)
src/tournament.js     lógica pura: tabela, chaveamento, classificação, CSV, backup
src/app.js            interface
tests/                testes com node:test
```

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT. Veja [LICENSE](LICENSE).
