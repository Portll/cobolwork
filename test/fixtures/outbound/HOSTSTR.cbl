       IDENTIFICATION DIVISION.
       PROGRAM-ID. HOSTSTR.
      * A row fetched into one field of a record, and one fetched into a host structure.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-ROW.
          05 F1 PIC X(40).
          05 F2 PIC X(40).
       01 WS-CUST.
          05 C1 PIC X(40).
          05 C2 PIC X(40).
       PROCEDURE DIVISION.
           EXEC SQL SELECT B INTO :WS-ROW.F2 FROM CUST END-EXEC
           EXEC SQL SELECT A, B INTO :WS-CUST FROM CUST END-EXEC
           EXEC CICS WRITEQ TD QUEUE('RPTQ') FROM(F1 OF WS-ROW) END-EXEC
           EXEC CICS WRITEQ TD QUEUE('RPTQ') FROM(F2 OF WS-ROW) END-EXEC
           EXEC CICS WRITEQ TD QUEUE('RPTQ') FROM(C2) END-EXEC
           EXEC CICS RETURN END-EXEC.
