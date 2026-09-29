       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYRPT.
      * Reads a file and returns. Nothing CMDSEC governs.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REC              PIC X(80).
       PROCEDURE DIVISION.
           EXEC CICS READ FILE('PAYFILE') INTO(WS-REC)
                RIDFLD(WS-REC) END-EXEC
           EXEC CICS RETURN END-EXEC.
