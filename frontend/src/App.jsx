import React, { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import './App.css';

// Set worker path using Vite-compatible approach
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.js',
  import.meta.url
).toString();

const App = () => {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

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

  const extractData = (pagesItems) => {
    const items = pagesItems[0];

    // "Gulf Star Lab" reports use plain English labels (Client Name, Location, Lab Job No...)
    // and lay results out at different x-positions than the older bilingual DWT-branded template.
    const isNewFormat = items.some(i => i.text.trim().toLowerCase() === "client name");

    // Some PDFs split RTL Arabic words into one isolated glyph per text item (in reversed
    // visual order), which reads as garbage once joined. Multi-character Arabic phrases
    // (stored as a single run) are legitimate and left alone.
    const isStrayArabicGlyph = (text) =>
      text.trim().length <= 2 && /[؀-ۿﭐ-﷿ﹰ-﻾]/.test(text);

    const findTextAfterLabel = (label, yTolerance = 5) => {
      const labelItem = items.find(item => item.text && item.text.toLowerCase().includes(label.toLowerCase()));
      if (!labelItem) return "";

      // Look for the NEXT label on the same line to prevent leakage
      const nextLabels = ["Sample ID", "Location", "Contact Person", "E-MAIL", "الموقع", "المرجع", "بريد"];
      const nextLabelItem = items.find(item =>
        Math.abs(item.y - labelItem.y) < yTolerance &&
        item.x > labelItem.x + 20 &&
        nextLabels.some(l => item.text && item.text.toLowerCase().includes(l.toLowerCase()))
      );

      const maxX = nextLabelItem ? nextLabelItem.x : labelItem.x + 300;

      const values = items.filter(item =>
        Math.abs(item.y - labelItem.y) < yTolerance &&
        item.x > labelItem.x &&
        item.x < maxX &&
        item.text.trim().length > 0 &&
        !item.text.toLowerCase().includes(label.toLowerCase()) &&
        !isStrayArabicGlyph(item.text)
      ).sort((a, b) => a.x - b.x);

      let text = values.map(v => v.text).join(" ").trim();

      // Aggressive cleanup of common bilingual label artifacts
      const cleanup = [
        ":", "/", "Company Name", "اسم الشركة", "Client Name",
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
        // Use regex for word boundaries if possible, or just replace
        const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'gi');
        text = text.replace(re, "").trim();
      });

      return text.replace(/^[ /:-]+/, "").replace(/[ /:-]+$/, "").trim();
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

      // New Gulf Star Lab template: "REMARKS & COMMENTS" heading with a paragraph below it,
      // possibly on a different page than page 1.
      for (const pageItems of pagesItems) {
        const heading = pageItems.find(i =>
          i.text.trim().toUpperCase().includes("REMARKS") && i.text.trim().toUpperCase().includes("COMMENTS")
        );
        if (!heading) continue;
        const below = pageItems
          .filter(i => i.y < heading.y && i.text.trim().length > 0)
          .sort((a, b) => b.y - a.y)[0];
        if (below && (heading.y - below.y) < 30) return below.text.trim();
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

    // Column x-ranges differ between the old DWT template and the new Gulf Star Lab template
    const cols = isNewFormat
      ? { sMin: 30, sMax: 46, paramMin: 140, paramMax: 270, methodMax: 386, resultMax: 446, unitMax: 506 }
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
            <h1 className="header-title">PDF-Reporting Tool</h1>
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

          <div className="report-view">
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

            <table className="results-table">
              <thead>
                <tr>
                  <th style={{ width: '30px' }}>
                    <EditableValue 
                      value={reportData.headers.s} 
                      onChange={(val) => handleEditHeader('s', val)}
                    />
                  </th>
                  <th>
                    <EditableValue
                      value={reportData.headers.parameter}
                      onChange={(val) => handleEditHeader('parameter', val)}
                    />
                  </th>
                  <th style={{ width: '100px' }}>
                    <EditableValue 
                      value={reportData.headers.method} 
                      onChange={(val) => handleEditHeader('method', val)}
                    />
                  </th>
                  <th style={{ width: '80px' }}>
                    <EditableValue 
                      value={reportData.headers.result} 
                      onChange={(val) => handleEditHeader('result', val)}
                    />
                  </th>
                  <th style={{ width: '60px' }}>
                    <EditableValue 
                      value={reportData.headers.unit} 
                      onChange={(val) => handleEditHeader('unit', val)}
                    />
                  </th>
                  <th style={{ width: '100px' }}>
                    <EditableValue 
                      value={reportData.headers.std} 
                      onChange={(val) => handleEditHeader('std', val)}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {reportData.rows.map((row, idx) => (
                  <tr key={idx}>
                    <td>
                      <EditableValue 
                        value={row.s} 
                        onChange={(val) => handleEditRow(idx, 's', val)}
                      />
                    </td>
                    <td className="param-name">
                      <EditableValue
                        value={row.parameter}
                        onChange={(val) => handleEditRow(idx, 'parameter', val)}
                      />
                    </td>
                    <td>
                      <EditableValue 
                        value={row.method} 
                        onChange={(val) => handleEditRow(idx, 'method', val)}
                      />
                    </td>
                    <td>
                      <EditableValue 
                        value={row.result} 
                        onChange={(val) => handleEditRow(idx, 'result', val)}
                      />
                    </td>
                    <td>
                      <EditableValue 
                        value={row.unit} 
                        onChange={(val) => handleEditRow(idx, 'unit', val)}
                      />
                    </td>
                    <td>
                      <EditableValue 
                        value={row.std} 
                        onChange={(val) => handleEditRow(idx, 'std', val)}
                      />
                    </td>
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
