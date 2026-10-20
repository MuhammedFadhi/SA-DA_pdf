import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import './App.css';

// Set worker path using Vite-compatible approach
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.js',
  import.meta.url
).toString();

// Results table columns, in display order. `key` indexes both reportData.headers and each row.
const COLUMNS = [
  { key: 's', width: '30px' },
  { key: 'parameter' },
  { key: 'method', width: '100px' },
  { key: 'result', width: '80px' },
  { key: 'unit', width: '60px' },
  { key: 'std', width: '100px' },
];

const App = () => {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const reportRef = useRef(null);

  // The footer sits at the bottom of .report-view, which is only one A4 page tall in print.
  // When the results run onto further pages, stretch the report to a whole number of pages
  // so the footer lands at the bottom of the last page instead of right after the content.
  // Print lays the report out at the preview's width (REPORT_WIDTH_PX, matching .print-measure
  // and the print .report-view rule) and zooms it down to A4 width, so the PDF matches the preview.
  useEffect(() => {
    const MM_TO_PX = 96 / 25.4;
    const REPORT_WIDTH_PX = 910;
    const ZOOM = (210 * MM_TO_PX) / REPORT_WIDTH_PX;
    // One A4 page height in pre-zoom px.
    const PAGE_HEIGHT_PX = (297 * MM_TO_PX) / ZOOM;
    // Space lost at each page break: the table header repeats on the new page, and the row
    // (or signature block) that doesn't fit is pushed down whole, leaving a gap.
    const PAGE_BREAK_ALLOWANCE_PX = 100;

    const fitToPages = () => {
      const el = reportRef.current;
      if (!el) return;
      el.classList.add('print-measure');
      const contentHeight = el.scrollHeight;
      el.classList.remove('print-measure');
      let pages = 1;
      while (contentHeight + (pages - 1) * PAGE_BREAK_ALLOWANCE_PX > pages * PAGE_HEIGHT_PX) pages++;
      el.style.setProperty('--print-zoom', ZOOM);
      // A few px short of N pages so rounding can't spill a blank page.
      el.style.setProperty('--print-height', `${pages * PAGE_HEIGHT_PX - 4}px`);
    };
    const reset = () => {
      reportRef.current?.style.removeProperty('--print-zoom');
      reportRef.current?.style.removeProperty('--print-height');
    };

    window.addEventListener('beforeprint', fitToPages);
    window.addEventListener('afterprint', reset);
    return () => {
      window.removeEventListener('beforeprint', fitToPages);
      window.removeEventListener('afterprint', reset);
    };
  }, []);

  const processFile = async (file) => {
    console.log("File selected:", file.name);
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      const pagesItems = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        pagesItems.push(textContent.items.map(item => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
          fontSize: Math.round(item.transform[0] * 10) / 10
        })));
      }

      console.log("PDF pages:", pagesItems.length, "page 1 items:", pagesItems[0].length);

      // Debug: Log all text items to see labels and positions
      console.table(pagesItems[0].slice(0, 50));

      const parsedData = extractData(pagesItems);
      console.log("Parsed Data:", parsedData);
      setReportData(parsedData);
    } catch (error) {
      console.error("Error parsing PDF:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type === "application/pdf") {
      processFile(file);
    } else if (file) {
      alert("Please upload a PDF file.");
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  // "Al Hoty - Stanger" reports: "Label : value" metadata, a right-hand header box
  // (TWO No. / Report No. / Report Date / Ref. No.), and a Test Name / Unit / Method / Results
  // table grouped under uppercase section headings (PHYSICAL PROPERTIES, ANION, ...).
  const extractAlHotyData = (pagesItems) => {
    const items = pagesItems[0];

    const valueOnRow = (label) => {
      const labelItem = items.find(i => i.text.trim().toLowerCase() === label.toLowerCase());
      if (!labelItem) return "";
      return items
        .filter(i => i !== labelItem && Math.abs(i.y - labelItem.y) < 3 && i.x > labelItem.x)
        .sort((a, b) => a.x - b.x)
        .map(i => i.text)
        .join(" ")
        .replace(/^[\s:]+/, "")
        .trim();
    };

    const clientItem = items.find(i => /^CLIENT\s*:/i.test(i.text.trim()));
    const locationItem = items.find(i => /Kingdom of Saudi Arabia/i.test(i.text));

    const data = {
      companyName: clientItem ? clientItem.text.replace(/^CLIENT\s*:/i, "").trim() : "Unknown Company",
      sampleType: valueOnRow("Sample Name") || "Water Analysis",
      sampleDate: valueOnRow("Sampled Date") || "N/A",
      reportDate: valueOnRow("Report Date") || "N/A",
      labJobNo: valueOnRow("Report No.") || valueOnRow("TWO No.") || "N/A",
      sampleId: valueOnRow("Sample No.") || "N/A",
      location: locationItem ? locationItem.text.split(",")[0].trim() : "N/A",
      contactPerson: "Sir",
      testReference: valueOnRow("Ref. No.") || "N/A",
      clientId: valueOnRow("TWO No.") || "N/A",
      emailPhone: "N/A",
      emailTelLabel: "TESTED BY",
      emailTel: "ASHIK KOYAMU",
      comment: "Based on the result, we would regard that the water sample meet the satisfactory Quality both chemically and microbiologically for domestic water and it is safe for drinking",
      headers: {
        s: "S",
        parameter: "Parameters / Testing اسم التحليل /الفحوصات",
        method: "Method طريقة الاختبار",
        result: "Result النتيجة",
        unit: "Unit الوحدة",
        std: "STD DRINKING WATER"
      },
      rows: []
    };

    let serial = 0;
    pagesItems.forEach(pageItems => {
      const header = pageItems.find(i => i.text.trim() === "Test Name");
      if (!header) return;
      const headerX = (label, fallback) =>
        (pageItems.find(i => i.text.trim() === label && Math.abs(i.y - header.y) < 3) || { x: fallback }).x;
      const unitX = headerX("Unit", 220) - 5;
      const methodX = headerX("Method", 326) - 5;
      // Results are right-aligned under their header, so they can start well left of it.
      const resultX = methodX + (headerX("Results", 535) - methodX) * 0.6;

      const body = pageItems.filter(i => i.y < header.y - 2 && i.y > 90 && i.text.trim());
      // A method can wrap onto two lines straddling the row's baseline, hence the loose tolerance.
      const sameRow = (a, b) => Math.abs(a.y - b.y) <= 7;
      const cell = (anchor, min, max) => body
        .filter(i => sameRow(i, anchor) && i.x >= min && i.x < max)
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map(i => i.text.trim())
        .join(" ");

      const leftItems = body.filter(i => i.x < unitX).sort((a, b) => b.y - a.y);
      const dataAnchors = leftItems.filter(a => body.some(i => sameRow(i, a) && i.x >= resultX));
      if (!dataAnchors.length) return;
      const lastDataY = dataAnchors[dataAnchors.length - 1].y;

      leftItems.forEach(anchor => {
        if (dataAnchors.includes(anchor)) {
          serial += 1;
          data.rows.push({
            s: String(serial),
            parameter: anchor.text.trim(),
            method: cell(anchor, methodX, resultX),
            result: cell(anchor, resultX, Infinity),
            unit: cell(anchor, unitX, methodX),
            std: ""
          });
        } else if (anchor.y > lastDataY && anchor.text === anchor.text.toUpperCase()) {
          // Section heading like "TRACE METALS"; skips the mixed-case "Analysis of Water" title
          // and anything below the table (signatures).
          data.rows.push({ section: true, s: "", parameter: anchor.text.trim(), method: "", result: "", unit: "", std: "" });
        }
      });
    });

    return data;
  };

  const extractData = (pagesItems) => {
    const items = pagesItems[0];

    if (items.some(i => /AL\s*HOTY/i.test(i.text))) {
      return extractAlHotyData(pagesItems);
    }

    // "Gulf Star Lab" reports use plain English labels (Client Name, Location, Lab Job No...)
    // and lay results out at different x-positions than the older bilingual DWT-branded template.
    // Some copies of this template render label words in a different font per word (e.g. "Client"
    // at one font size, "Name" at another), which makes pdf.js emit them as separate text items
    // instead of one merged item - so an exact single-item match for "client name" can miss it.
    const allTextJoined = items.map(i => i.text).join("").toLowerCase().replace(/\s+/g, "");
    const isNewFormat = items.some(i => i.text.trim().toLowerCase() === "client name") ||
      allTextJoined.includes("clientname") ||
      allTextJoined.includes("analysisresults");

    // Some PDFs split RTL Arabic words into isolated glyph runs per text item (in reversed
    // visual order), which reads as garbage once joined. Multi-character Arabic phrases
    // (stored as a single run) are legitimate and left alone.
    const isStrayArabicGlyph = (text) =>
      text.trim().length <= 5 && /[؀-ۿﭐ-﷿ﹰ-﻾]/.test(text);

    // Groups items on the page into visual rows (by y-proximity), sorted left-to-right,
    // so a label split across multiple text items can still be found and bounded correctly.
    const buildLines = (its, yTolerance) => {
      const sorted = [...its].sort((a, b) => b.y - a.y);
      const lines = [];
      sorted.forEach(item => {
        let line = lines.find(l => Math.abs(l.y - item.y) < yTolerance);
        if (!line) {
          line = { y: item.y, items: [] };
          lines.push(line);
        }
        line.items.push(item);
      });
      lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
      return lines;
    };

    const norm = (s) => s.toLowerCase().replace(/\s+/g, "");

    const findTextAfterLabel = (label, yTolerance = 5) => {
      const lines = buildLines(items, yTolerance);
      const normLabel = norm(label);

      // Labels that may appear right after our target label on the same row, used to
      // bound where its value ends (prevents leaking into a neighboring column's text).
      const nextLabels = ["Sample ID", "Location", "Contact Person", "E-MAIL", "Lab Job No",
        "Sample Type", "Sample Date", "Report Date", "Client ID", "Client Name", "Test Reference",
        "الموقع", "المرجع", "بريد"].map(norm).filter(Boolean);

      for (const line of lines) {
        // Concatenate the row's (whitespace-stripped) text while remembering which
        // item produced each character, so a label split across multiple items can
        // still be located and its exact item-boundary recovered.
        let text = "";
        const charItemIdx = [];
        line.items.forEach((item, idx) => {
          const t = norm(item.text);
          for (const ch of t) {
            text += ch;
            charItemIdx.push(idx);
          }
        });

        const pos = text.indexOf(normLabel);
        if (pos === -1) continue;
        const labelEndCharPos = pos + normLabel.length - 1;
        const labelEndIdx = charItemIdx[labelEndCharPos];

        let nextLabelCharPos = -1;
        for (const nl of nextLabels) {
          const p = text.indexOf(nl, labelEndCharPos + 1);
          if (p !== -1 && (nextLabelCharPos === -1 || p < nextLabelCharPos)) nextLabelCharPos = p;
        }
        const nextLabelStartIdx = nextLabelCharPos === -1 ? undefined : charItemIdx[nextLabelCharPos];

        const values = line.items
          .slice(labelEndIdx + 1, nextLabelStartIdx)
          .filter(item => item.text.trim().length > 0 && !isStrayArabicGlyph(item.text));

        let valueText = values.map(v => v.text).join(" ").trim();

        // Aggressive cleanup of common bilingual label artifacts
        const cleanup = [
          ":", "Company Name", "اسم الشركة", "Client Name",
          "Sample Type", "نوع العينة",
          "Sample ID", "المرجع",
          "Sample Date", "تاريخ استلام العينة",
          "Location / Site", "الموقع", "Location",
          "Report Date", "تاريخ التقرير",
          "Contact Person",
          "E-MAIL / TEL", "بريد /هاتف", "هاتف",
          "E-MAIL / Phone",
          "Lab Job No",
          "Comment", "ملاحظة", "مالحظة",
          "Test Reference", "Client ID"
        ];
        cleanup.forEach(c => {
          const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(escaped, 'gi');
          valueText = valueText.replace(re, "").trim();
        });

        const finalText = valueText.replace(/^[ /:-]+/, "").replace(/[ /:-]+$/, "").trim();
        if (finalText) return finalText;
      }
      return "";
    };

    const findJobNo = () => {
      const item = items.find(i => i.text.match(/DWT-\d+-\d+/));
      return item ? item.text : (findTextAfterLabel("Lab Job No") || "N/A");
    };

    const defaultComment = "Based on the result, we would regard that the water sample meet the satisfactory Quality both chemically and microbiologically for domestic water and it is safe for drinking";

    // The lab's own remark overrides the generic "safe for drinking" boilerplate when present.
    const findRemarks = () => {
      // Old bilingual template: "Comment - ملاحظة   <value>" on one row.
      const sameRow = findTextAfterLabel("Comment");
      if (sameRow) return sameRow;

      // New Gulf Star Lab template: "REMARKS & COMMENTS" heading with a paragraph below it
      // (sometimes wrapping onto multiple lines), possibly on a different page than page 1.
      for (const pageItems of pagesItems) {
        const heading = pageItems.find(i =>
          i.text.trim().toUpperCase().includes("REMARKS") && i.text.trim().toUpperCase().includes("COMMENTS")
        );
        if (!heading) continue;

        const candidates = pageItems
          .filter(i => i.y < heading.y && i.text.trim().length > 0)
          .sort((a, b) => b.y - a.y);

        const lines = [];
        let lastY = heading.y;
        for (const item of candidates) {
          if (lastY - item.y > 30) break; // gap too large: next section (e.g. "Lab Manager"), not a wrapped line
          lines.push(item.text.trim());
          lastY = item.y;
        }
        if (lines.length) return lines.join(" ");
      }
      return "";
    };

    // Robust field mapping
    const data = {
      companyName: findTextAfterLabel("Company Name") || findTextAfterLabel("اسم الشركة") || findTextAfterLabel("Client Name") || "Unknown Company",
      sampleType: findTextAfterLabel("Sample Type") || findTextAfterLabel("نوع العينة") || "Water Analysis",
      sampleDate: findTextAfterLabel("Sample Date") || findTextAfterLabel("تاريخ استلام العينة") || "N/A",
      reportDate: findTextAfterLabel("Report Date") || findTextAfterLabel("تاريخ التقرير") || "N/A",
      labJobNo: findJobNo(),
      sampleId: findTextAfterLabel("Sample ID") || findTextAfterLabel("المرجع") || "N/A",
      location: findTextAfterLabel("Location / Site") || findTextAfterLabel("الموقع") || findTextAfterLabel("Location") || "N/A",
      contactPerson: findTextAfterLabel("Contact Person") || "Sir",
      testReference: findTextAfterLabel("Test Reference") || "N/A",
      clientId: findTextAfterLabel("Client ID") || "N/A",
      emailPhone: findTextAfterLabel("E-MAIL / Phone") || findTextAfterLabel("E-MAIL / TEL") || "N/A",
      emailTelLabel: "TESTED BY",
      emailTel: "ASHIK KOYAMU",
      comment: findRemarks() || defaultComment,
      headers: {
        s: "S",
        parameter: "Parameters / Testing اسم التحليل /الفحوصات",
        method: "Method طريقة الاختبار",
        result: "Result النتيجة",
        unit: "Unit الوحدة",
        std: "STD DRINKING WATER"
      },
      rows: []
    };

    // Column x-ranges differ between the old DWT template and the new Gulf Star Lab template.
    // The Gulf Star Lab template itself has two variants seen in the wild: some copies include
    // an "Analysis Type" column (pushing Parameter further right), some don't.
    const hasAnalysisTypeColumn = items.some(i => i.text.trim() === "Analysis Type");
    const cols = isNewFormat
      ? { sMin: 30, sMax: 46, paramMin: hasAnalysisTypeColumn ? 140 : 46, paramMax: 270, methodMax: 386, resultMax: 446, unitMax: 506 }
      : { sMin: 50, sMax: 65, paramMin: 65, paramMax: 250, methodMax: 330, resultMax: 405, unitMax: 475 };

    // Table Extraction: results can span multiple PDF pages, each repeating its own header row
    pagesItems.forEach(pageItems => {
      const headerItem = pageItems.find(i => i.text.includes("Method") || i.text.includes("طريقة الاختبار"));
      if (!headerItem) return;

      // Rows are usually below the header and start with a number
      const rowsBelowHeader = pageItems.filter(i =>
        i.y < headerItem.y &&
        i.x > cols.sMin && i.x < cols.sMax &&
        !isNaN(parseInt(i.text)) &&
        i.y > 200 // End of table area roughly
      ).sort((a, b) => b.y - a.y);

      const pageRows = rowsBelowHeader.map(marker => {
        const y = marker.y;
        const r = pageItems.filter(i => Math.abs(i.y - y) < 8 && !isStrayArabicGlyph(i.text)).sort((a, b) => a.x - b.x);

        return {
          s: marker.text,
          parameter: r.filter(i => i.x > cols.paramMin && i.x < cols.paramMax).map(i => i.text).join(" "),
          method: r.filter(i => i.x >= cols.paramMax && i.x < cols.methodMax).map(i => i.text).join(" "),
          result: r.filter(i => i.x >= cols.methodMax && i.x < cols.resultMax).map(i => i.text).join(" "),
          unit: r.filter(i => i.x >= cols.resultMax && i.x < cols.unitMax).map(i => i.text).join(" "),
          std: r.filter(i => i.x >= cols.unitMax).map(i => i.text).join(" ")
        };
      });

      data.rows.push(...pageRows);
    });

    return data;
  };

  const handleEditMetadata = (field, value) => {
    setReportData(prev => ({ ...prev, [field]: value }));
  };

  // Hidden columns live on reportData so "Upload New" starts with every column visible again.
  const hiddenColumns = reportData?.hiddenColumns || [];
  const visibleColumns = COLUMNS.filter(col => !hiddenColumns.includes(col.key));

  const toggleColumn = (key) => {
    setReportData(prev => {
      const hidden = prev.hiddenColumns || [];
      const next = hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key];
      // Keep at least one column so the table never collapses to nothing.
      if (next.length >= COLUMNS.length) return prev;
      return { ...prev, hiddenColumns: next };
    });
  };

  const handleEditHeader = (field, value) => {
    setReportData(prev => ({ 
      ...prev, 
      headers: { ...prev.headers, [field]: value }
    }));
  };

  const handleEditRow = (idx, field, value) => {
    const newRows = [...reportData.rows];
    newRows[idx] = { ...newRows[idx], [field]: value };
    setReportData(prev => ({ ...prev, rows: newRows }));
  };

  const EditableValue = ({ value, onChange, className = "" }) => (
    <div 
      contentEditable 
      suppressContentEditableWarning 
      onBlur={(e) => onChange(e.target.innerText)}
      className={`editable-field ${className}`}
    >
      {value}
    </div>
  );

  return (
    <div className="page-wrapper">
      <header className="main-header">
        <div className="header-inner">
          <div className="header-left">
            <img src="/black%20logo%20400px200.png" alt="Company Logo" className="header-logo" />
          </div>
          <div className="header-right">
            {reportData && (
              <div className="header-controls">
                <button className="btn btn-secondary" onClick={() => setReportData(null)}>Upload New</button>
                <button className="btn btn-primary" onClick={() => window.print()}>Print Report</button>
              </div>
            )}
            <h1 className="header-title">PDF-Reporting Tool <span className="header-version">v2.1</span></h1>
          </div>
        </div>
      </header>

      <div className="app-container">
        {!reportData ? (
        <div 
          className="upload-section" 
          onClick={() => fileInputRef.current.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept="application/pdf" 
            style={{ display: 'none' }} 
          />
          <div style={{ fontSize: '48px', color: '#1e3a5f', marginBottom: '20px' }}>📄</div>
          <h2>Upload Laboratory PDF</h2>
          <p>Drag and drop your PDF here to convert and edit</p>
          {loading && <p>Processing... Please wait.</p>}
        </div>
      ) : (
        <div className="report-container">

          <div className="report-view" ref={reportRef}>
            <img src="/header.png" alt="Header" className="header-img" />
            
            <div className="report-title-bar">
              <div className="report-title">Result Report - نتيجة التقرير</div>
              <div className="barcode-container">
                <div className="barcode">*{reportData.labJobNo}*</div>
                <EditableValue 
                  value={reportData.labJobNo} 
                  onChange={(val) => handleEditMetadata('labJobNo', val)}
                  className="job-id-label"
                />
              </div>
            </div>

            <div className="metadata-grid">
              {/* Row 1 */}
              <div className="metadata-item" style={{ gridColumn: 'span 2' }}>
                <div className="metadata-label">Company Name اسم الشركة</div>
                <EditableValue 
                  value={reportData.companyName} 
                  onChange={(val) => handleEditMetadata('companyName', val)}
                  className="metadata-value"
                />
              </div>

              {/* Row 2 */}
              <div className="metadata-item">
                <div className="metadata-label">Sample Type نوع العينة</div>
                <EditableValue 
                  value={reportData.sampleType} 
                  onChange={(val) => handleEditMetadata('sampleType', val)}
                  className="metadata-value"
                />
              </div>
              <div className="metadata-item">
                <div className="metadata-label">Sample ID المرجع</div>
                <EditableValue 
                  value={reportData.sampleId} 
                  onChange={(val) => handleEditMetadata('sampleId', val)}
                  className="metadata-value"
                />
              </div>

              {/* Row 3 */}
              <div className="metadata-item">
                <div className="metadata-label">Sample Date تاريخ العينة</div>
                <EditableValue 
                  value={reportData.sampleDate} 
                  onChange={(val) => handleEditMetadata('sampleDate', val)}
                  className="metadata-value"
                />
              </div>
              <div className="metadata-item">
                <div className="metadata-label">Location / Site الموقع</div>
                <EditableValue 
                  value={reportData.location} 
                  onChange={(val) => handleEditMetadata('location', val)}
                  className="metadata-value"
                />
              </div>

              {/* Row 4 */}
              <div className="metadata-item">
                <div className="metadata-label">Report Date تاريخ التقرير</div>
                <EditableValue 
                  value={reportData.reportDate} 
                  onChange={(val) => handleEditMetadata('reportDate', val)}
                  className="metadata-value"
                />
              </div>
              <div className="metadata-item">
                <div className="metadata-label">Contact Person</div>
                <EditableValue 
                  value={reportData.contactPerson} 
                  onChange={(val) => handleEditMetadata('contactPerson', val)}
                  className="metadata-value"
                />
              </div>

              {/* Row 5 */}
              <div className="metadata-item">
                <div className="metadata-label">Lab Job No.</div>
                <EditableValue 
                  value={reportData.labJobNo} 
                  onChange={(val) => handleEditMetadata('labJobNo', val)}
                  className="metadata-value"
                />
              </div>
              <div className="metadata-item">
                <EditableValue
                  value={reportData.emailTelLabel}
                  onChange={(val) => handleEditMetadata('emailTelLabel', val)}
                  className="metadata-label"
                />
                <EditableValue
                  value={reportData.emailTel}
                  onChange={(val) => handleEditMetadata('emailTel', val)}
                  className="metadata-value"
                />
              </div>

              {/* Row 6 */}
              <div className="metadata-item">
                <div className="metadata-label">Test Reference</div>
                <EditableValue
                  value={reportData.testReference}
                  onChange={(val) => handleEditMetadata('testReference', val)}
                  className="metadata-value"
                />
              </div>
              <div className="metadata-item">
                <div className="metadata-label">Client ID</div>
                <EditableValue
                  value={reportData.clientId}
                  onChange={(val) => handleEditMetadata('clientId', val)}
                  className="metadata-value"
                />
              </div>

              {/* Row 7 */}
              <div className="metadata-item" style={{ gridColumn: 'span 2' }}>
                <div className="metadata-label">E-MAIL / Phone</div>
                <EditableValue
                  value={reportData.emailPhone}
                  onChange={(val) => handleEditMetadata('emailPhone', val)}
                  className="metadata-value"
                />
              </div>
            </div>

            {hiddenColumns.length > 0 && (
              <div className="hidden-columns-bar">
                <span>Hidden columns:</span>
                {COLUMNS.filter(col => hiddenColumns.includes(col.key)).map(col => (
                  <button key={col.key} className="column-restore-btn" onClick={() => toggleColumn(col.key)} title="Show this column again">
                    + {reportData.headers[col.key]}
                  </button>
                ))}
              </div>
            )}

            <table className="results-table">
              <thead>
                <tr>
                  {visibleColumns.map(col => (
                    <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                      <button className="column-hide-btn" onClick={() => toggleColumn(col.key)} title="Hide this column">−</button>
                      <EditableValue
                        value={reportData.headers[col.key]}
                        onChange={(val) => handleEditHeader(col.key, val)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reportData.rows.map((row, idx) => row.section ? (
                  <tr key={idx} className="section-row">
                    <td colSpan={visibleColumns.length}>
                      <EditableValue
                        value={row.parameter}
                        onChange={(val) => handleEditRow(idx, 'parameter', val)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={idx}>
                    {visibleColumns.map(col => (
                      <td key={col.key} className={col.key === 'parameter' ? 'param-name' : undefined}>
                        <EditableValue
                          value={row[col.key]}
                          onChange={(val) => handleEditRow(idx, col.key, val)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="comment-section" style={{ textAlign: 'left', fontSize: '11px', padding: '5px 10px', marginTop: '5px', borderBottom: '1px solid black' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>Comment - ملاحظة</div>
              <div style={{ color: '#0056b3' }}>
                <EditableValue 
                  value={reportData.comment} 
                  onChange={(val) => handleEditMetadata('comment', val)}
                  className="comment-value"
                />
              </div>
            </div>

            <div className="signature-area">
              <div className="signature-left">
                <p className="regards-text">Best Regards</p>
                <p className="company-sig-text">SA'DA Water</p>
                <div className="signature-placeholder">
                  <img src="/seal.png" alt="Seal" className="seal-img" />
                </div>
              </div>
            </div>

            <img src="/footer.png" alt="Footer" className="footer-img" />
          </div>
        </div>
      )}
      </div>
      
      <footer className="app-footer">
        <span>Powered by</span>
        <img src="/effedo_logo.png" alt="Effedo Logo" className="footer-effedo-logo" />
      </footer>
    </div>
  );
};

export default App;
