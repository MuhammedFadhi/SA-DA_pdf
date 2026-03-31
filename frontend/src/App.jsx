import React, { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import './App.css';

// Set worker path using Vite-compatible approach
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

const App = () => {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    console.log("File selected:", file.name);
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const textContent = await page.getTextContent();
      
      console.log("PDF Text Content:", textContent.items.length, "items found");
      
      const items = textContent.items.map(item => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
        fontSize: Math.round(item.transform[0] * 10) / 10
      }));

      // Debug: Log all text items to see labels and positions
      console.table(items.slice(0, 50)); 

      const parsedData = extractData(items);
      console.log("Parsed Data:", parsedData);
      setReportData(parsedData);
    } catch (error) {
      console.error("Error parsing PDF:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const extractData = (items) => {
    // Sort items by Y descending, then X ascending
    const sortedItems = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    
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
        !item.text.toLowerCase().includes(label.toLowerCase())
      ).sort((a, b) => a.x - b.x);

      let text = values.map(v => v.text).join(" ").trim();
      
      // Aggressive cleanup of common bilingual label artifacts
      const cleanup = [
        ":", "/", "Company Name", "اسم الشركة", 
        "Sample Type", "نوع العينة", 
        "Sample ID", "المرجع", 
        "Sample Date", "تاريخ استلام العينة", 
        "Location / Site", "الموقع", 
        "Report Date", "تاريخ التقرير", 
        "Contact Person", 
        "E-MAIL / TEL", "بريد /هاتف", "هاتف"
      ];
      cleanup.forEach(c => {
        // Use regex for word boundaries if possible, or just replace
        const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'gi');
        text = text.replace(re, "").trim();
      });
      
      return text.replace(/^[ /:]+/, "").replace(/[ /:]+$/, "").trim();
    };

    const findJobNo = () => {
      const item = items.find(i => i.text.match(/DWT-\d+-\d+/));
      return item ? item.text : "N/A";
    };

    // Robust field mapping
    const data = {
      companyName: findTextAfterLabel("Company Name") || findTextAfterLabel("اسم الشركة") || "Unknown Company",
      sampleType: findTextAfterLabel("Sample Type") || findTextAfterLabel("نوع العينة") || "Water Analysis",
      sampleDate: findTextAfterLabel("Sample Date") || findTextAfterLabel("تاريخ استلام العينة") || "N/A",
      reportDate: findTextAfterLabel("Report Date") || findTextAfterLabel("تاريخ التقرير") || "N/A",
      labJobNo: findJobNo(),
      sampleId: findTextAfterLabel("Sample ID") || findTextAfterLabel("المرجع") || "N/A",
      location: findTextAfterLabel("Location / Site") || findTextAfterLabel("الموقع") || "N/A",
      contactPerson: findTextAfterLabel("Contact Person") || "Sir",
      emailTel: findTextAfterLabel("E-MAIL / TEL") || "**",
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

    // Table Extraction: Find header row first
    const headerItem = items.find(i => i.text.includes("Method") || i.text.includes("طريقة الاختبار"));
    if (!headerItem) return data;

    // Rows are usually below the header and start with a number
    const rowsBelowHeader = items.filter(i => 
      i.y < headerItem.y && 
      i.x > 50 && i.x < 65 && 
      !isNaN(parseInt(i.text)) &&
      i.y > 200 // End of table area roughly
    ).sort((a, b) => b.y - a.y);

    data.rows = rowsBelowHeader.map(marker => {
      const y = marker.y;
      const r = items.filter(i => Math.abs(i.y - y) < 8).sort((a, b) => a.x - b.x);
      
      return {
        s: marker.text,
        parameter: r.filter(i => i.x > 65 && i.x < 250).map(i => i.text).join(" "),
        method: r.filter(i => i.x >= 250 && i.x < 330).map(i => i.text).join(" "),
        result: r.filter(i => i.x >= 330 && i.x < 425).map(i => i.text).join(" "),
        unit: r.filter(i => i.x >= 425 && i.x < 475).map(i => i.text).join(" "),
        std: r.filter(i => i.x >= 475).map(i => i.text).join(" ")
      };
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
    <div className="app-container">
      {!reportData ? (
        <div className="upload-section" onClick={() => fileInputRef.current.click()}>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept="application/pdf" 
            style={{ display: 'none' }} 
          />
          <div style={{ fontSize: '48px', color: '#1e3a5f', marginBottom: '20px' }}>📄</div>
          <h2>Upload Laboratory PDF</h2>
          <p>Drag and drop your Gulf Star Lab PDF here to convert and edit</p>
          {loading && <p>Processing... Please wait.</p>}
        </div>
      ) : (
        <div className="report-container">
          <div className="controls">
            <button className="btn btn-secondary" onClick={() => setReportData(null)}>Upload New</button>
            <button className="btn btn-primary" onClick={() => window.print()}>Print Report</button>
          </div>

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
                <div className="metadata-label">E-MAIL / TEL</div>
                <EditableValue 
                  value={reportData.emailTel} 
                  onChange={(val) => handleEditMetadata('emailTel', val)}
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
  );
};

export default App;
