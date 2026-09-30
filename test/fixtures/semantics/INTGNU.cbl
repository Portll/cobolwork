       IDENTIFICATION DIVISION.
       PROGRAM-ID. INTGNU.
      * 36 digits: GnuCOBOL takes it, Enterprise COBOL does not.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-A       PIC 9(36).
       01 WS-B       PIC 9(36).
       01 WS-R       PIC 9(36).
       PROCEDURE DIVISION.
           COMPUTE WS-R = WS-A * WS-B
           GOBACK.
