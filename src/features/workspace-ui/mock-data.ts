export const noteRows = [
  [
    "00012589",
    "Construtora Silva Ltda.",
    "28/05/2024",
    "R$ 249.200,00",
    "OK",
    "demo-00012589",
    "Residencial Parque das Águas",
  ],
  [
    "00012567",
    "Transportes Ideal",
    "27/05/2024",
    "R$ 18.900,00",
    "Suspeita",
    "demo-00012567",
    "Centro Empresarial Rio Branco",
  ],
  [
    "00012543",
    "Elétrica Forte Ltda.",
    "27/05/2024",
    "R$ 6.750,00",
    "OK",
    "demo-00012543",
    "Hospital Municipal de Sorriso",
  ],
  [
    "00012541",
    "MegaParafusos",
    "26/05/2024",
    "R$ 3.420,00",
    "Suspeita",
    "demo-00012541",
    "Residencial Parque das Águas",
  ],
  [
    "00012532",
    "Locação Equip. Sul",
    "26/05/2024",
    "R$ 12.500,00",
    "Suspeita",
    "demo-00012532",
    "Centro Empresarial Rio Branco",
  ],
  [
    "00012510",
    "Concretos Certos",
    "25/05/2024",
    "R$ 21.300,00",
    "OK",
    "demo-00012510",
    "Hospital Municipal de Sorriso",
  ],
  [
    "00012498",
    "Hidráulica Prime",
    "24/05/2024",
    "R$ 15.800,00",
    "Suspeita",
    "demo-00012498",
    "Residencial Parque das Águas",
  ],
  [
    "00012487",
    "Ferragens Brasil",
    "24/05/2024",
    "R$ 4.950,00",
    "OK",
    "demo-00012487",
    "Centro Empresarial Rio Branco",
  ],
] as const;

export const validationRows = noteRows.slice(0, 7).map((row, index) => ({
  id: row[5],
  number: row[0],
  supplier: row[1],
  date: row[2],
  value: row[3],
  state:
    index === 0 || index === 3
      ? "danger"
      : index === 1 || index === 4 || index === 6
        ? "warning"
        : "ok",
  classification: row[4],
  work: row[6],
}));

export const workRows = [
  [
    "Residencial Parque das Águas",
    "OBR-0001",
    "Goiânia - GO",
    "Carlos Menezes",
    "Ativa",
  ],
  [
    "Centro Empresarial Rio Branco",
    "OBR-0002",
    "Rio Branco - AC",
    "Fernanda Lima",
    "Ativa",
  ],
  [
    "Hospital Municipal de Sorriso",
    "OBR-0003",
    "Sorriso - MT",
    "Juliano Ferreira",
    "Ativa",
  ],
  [
    "Escola Técnica de Joinville",
    "OBR-0004",
    "Joinville - SC",
    "Patrícia Souza",
    "Inativa",
  ],
  [
    "Condomínio Vista do Sol",
    "OBR-0005",
    "Fortaleza - CE",
    "Carlos Menezes",
    "Ativa",
  ],
  [
    "Rodovia BR-242 - Trecho 02",
    "OBR-0006",
    "Barreiras - BA",
    "Juliano Ferreira",
    "Ativa",
  ],
] as const;

export const logRows = [
  [
    "28/05/2024 10:35:42",
    "00012589",
    "Rafael marcou como Suspeita",
    "Divergência de quantidade",
    "Suspeita",
  ],
  [
    "28/05/2024 09:18:11",
    "00012560",
    "Rafael marcou como OK",
    "Valores de acordo com contrato",
    "OK",
  ],
  [
    "27/05/2024 16:43:09",
    "00012541",
    "Rafael marcou como Suspeita",
    "Material não previsto em contrato",
    "Suspeita",
  ],
  [
    "27/05/2024 14:22:33",
    "00012532",
    "Rafael marcou como OK",
    "Preço acima do praticado",
    "OK",
  ],
  [
    "26/05/2024 11:07:58",
    "00012510",
    "Rafael marcou como OK",
    "Serviço executado conforme medição",
    "OK",
  ],
] as const;
