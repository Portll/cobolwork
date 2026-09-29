       IDENTIFICATION DIVISION.
       PROGRAM-ID. INTRAQ.
      * The same row, to a queue that stays inside the region.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-ROW              PIC X(80).
       PROCEDURE DIVISION.
           EXEC SQL SELECT CUST_DATA INTO :WS-ROW FROM CUST END-EXEC
           EXEC CICS WRITEQ TD QUEUE('SCRQ') FROM(WS-ROW) END-EXEC
           EXEC CICS RETURN END-EXEC.
