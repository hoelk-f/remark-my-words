import {deflateSync} from 'node:zlib';

export function fixturePdf(pages = 2) {
  const line = (text, x, y, size = 12, font = 'F1') => `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm <${Buffer.from(text, 'latin1').toString('hex')}> Tj ET\n`;
  let stream = line('Universität Musterstadt', 48, 795, 10) + line('Müller et al. (2023)', 432, 795, 10);
  stream += line('F', 48, 768, 18) + line('RAMEWORK', 57, 768, 14);
  stream += line('Der Einfluss von Gewohnheiten', 48, 737, 23, 'F2') + line('auf produktives Arbeiten', 48, 710, 23, 'F2');
  const sections = [
    ['1.  Einleitung', ['Gewohnheiten spielen eine zentrale Rolle in unserem alltäglichen Handeln.', 'Sie ermöglichen es, kognitive Ressourcen zu sparen und wiederkehrende', 'Aufgaben effizient zu bewältigen. In den letzten Jahren ist das Interesse', 'an der Formierung und Veränderung von Gewohnheiten deutlich gestiegen.', '', 'Trotz dieser Fortschritte bleibt jedoch unklar, in welchem Ausmaß', 'Gewohnheiten langfristig wirken und welche Faktoren entscheidend sind.', 'Nicht alle Gewohnheiten sind per se positiv zu bewerten, sondern der', 'Kontext spielt eine entscheidende Rolle.']],
    ['2.  Theoretischer Hintergrund', ['Der Begriff der Gewohnheit wird in der Forschung unterschiedlich definiert.', 'Einige Autoren verstehen Gewohnheiten als automatisierte Verhaltensweisen.', 'Andere betonen die Bedeutung bewusster kognitiver Prozesse.', 'Dazu finden sich Hinweise bei Lally et al. (2010).']],
    ['3.  Methodik', ['In der vorliegenden Studie wurde ein Mixed-Methods-Ansatz gewählt.', 'Quantitative Umfragedaten wurden mit qualitativen Interviews kombiniert.', 'Die Stichprobe umfasste N = 120 Teilnehmende über acht Wochen.', 'Die Daten wurden mittels standardisierter Claimbögen erhoben.']],
    ['4.  Ergebnisse', ['Die Ergebnisse zeigen einen Zusammenhang mit höherer Produktivität.', 'Gleichzeitig zeigen sich individuelle Unterschiede und situative Faktoren.', 'Der Kontext spielt eine wichtige moderierende Rolle.']],
  ];
  let y = 660;
  for (const [heading, lines] of sections) {
    stream += line(heading, 48, y, 16, 'F2'); y -= 26;
    for (const text of lines) { if (text) stream += line(text, 48, y); y -= text ? 17 : 9; }
    y -= 25;
  }
  stream += line('1', 292, 30, 10);
  const second = line('Diskussion und Ausblick', 48, 750, 23, 'F2') + line('Weitere Forschung untersucht langfristige Effekte.', 48, 690) + line('2', 292, 30, 10);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>`${i+3} 0 R`).join(' ')}] /Count ${pages} >>`,
    ...Array.from({length:pages},(_,i)=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${i===0?842:792}] /Resources << /Font << /F1 ${pages+3} 0 R /F2 ${pages+4} 0 R >> >> /Contents ${i===0?pages+5:pages+6} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    `<< /Length ${second.length} >>\nstream\n${second}endstream`,
  ];
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}

/** Mixed page sizes, independently compressed images, text and vector content. */
export function complexPdf(pages = 12) {
  const font = 3 + pages * 3;
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from(`<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>`${3+i*3} 0 R`).join(' ')}] /Count ${pages} >>`)];
  for (let index=0;index<pages;index++) {
    const id=3+index*3,width=index%3===2?842:595,height=[842,792,595,1100][index%4];
    const pixels=Buffer.alloc(320*480*3);let seed=index+1;
    for(let n=0;n<pixels.length;n++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[n]=seed>>>24;}
    const compressed=deflateSync(pixels);
    let stream=`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n1 1 1 rg 20 ${height-100} ${width-40} 80 re f\n0 0 0 rg BT /F1 18 Tf 35 ${height-60} Td (Complex page ${index+1}) Tj ET\n`;
    for(let n=0;n<1200;n++)stream+=`${(n%10)/10} 0.3 0.6 rg ${n*17%width} ${n*31%(height-120)} 2 3 re f\n`;
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`));
    objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 320 /Height 480 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),compressed,Buffer.from('\nendstream')]));
    objects.push(Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`));
  }
  objects.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  const parts=[Buffer.from('%PDF-1.4\n')],offsets=[0];let offset=parts[0].length;
  objects.forEach((object,i)=>{offsets.push(offset);const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);parts.push(chunk);offset+=chunk.length;});
  parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));
  return Buffer.concat(parts);
}
