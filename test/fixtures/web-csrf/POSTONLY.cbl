       IDENTIFICATION DIVISION.
       PROGRAM-ID. POSTONLY.
      * Only a POST starts the batch transaction, which a forged form sends.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FORM             PIC X(80).
       01 WS-METHOD           PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-FORM) LENGTH(LENGTH OF WS-FORM)
           END-EXEC
           EXEC CICS WEB EXTRACT HTTPMETHOD(WS-METHOD)
                METHODLENGTH(LENGTH OF WS-METHOD) END-EXEC
           IF WS-METHOD = 'POST'
               EXEC CICS START TRANSID('PAY1') END-EXEC
           END-IF
           EXEC CICS RETURN END-EXEC.
